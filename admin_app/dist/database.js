import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class AdminDatabase {
    constructor() {
        this.db = null;
        // Use LiteFS mount for shared database
        // In production: /litefs/games.db (LiteFS mount)
        // In local dev: use local persistent storage
        if (process.env.FLY_APP_NAME) {
            // Production: use LiteFS mount
            this.dbPath = '/litefs/games.db';
        }
        else {
            // Local development: use local persistent storage
            const persistentStoragePath = path.join(__dirname, '../persistent_app_files');
            this.dbPath = path.join(persistentStoragePath, 'games.db');
        }
        console.log(`Admin database will be at: ${this.dbPath}`);
    }
    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Failed to open database:', err);
                    reject(err);
                    return;
                }
                console.log(`Database opened at: ${this.dbPath}`);
                this.createTables().then(resolve).catch(reject);
            });
        });
    }
    async createTables() {
        if (!this.db)
            throw new Error('Database not initialized');
        const tables = [
            // Games table - stores individual game records
            `CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field TEXT NOT NULL,
        time TEXT NOT NULL,
        team1 TEXT NOT NULL DEFAULT '',
        team2 TEXT NOT NULL DEFAULT '',
        year TEXT NOT NULL,
        game_duration TEXT NOT NULL,
        game_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
            // Processing log table - tracks PDF processing history
            `CREATE TABLE IF NOT EXISTS processing_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        document_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'downloaded',
        error_message TEXT,
        games_extracted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
            // Indexes for better performance
            `CREATE INDEX IF NOT EXISTS idx_games_field_time ON games(field, time)`,
            `CREATE INDEX IF NOT EXISTS idx_games_year ON games(year)`,
            `CREATE INDEX IF NOT EXISTS idx_processing_log_status ON processing_log(status, created_at)`
        ];
        for (const sql of tables) {
            await new Promise((resolve, reject) => {
                this.db.run(sql, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        }
        console.log('Database tables created/verified');
    }
    // Start a new processing session
    async startProcessing(filename, documentDate) {
        if (!this.db)
            throw new Error('Database not initialized');
        return new Promise((resolve, reject) => {
            this.db.run(`INSERT INTO processing_log (filename, document_date, status) 
         VALUES (?, ?, 'processing')`, [filename, documentDate], function (err) {
                if (err) {
                    reject(err);
                }
                else {
                    console.log(`Started processing session ${this.lastID} for ${filename}`);
                    resolve(this.lastID);
                }
            });
        });
    }
    // Save extracted games data to database
    async saveGamesData(processingId, gameData) {
        if (!this.db)
            throw new Error('Database not initialized');
        let gamesInserted = 0;
        try {
            // Start transaction
            await new Promise((resolve, reject) => {
                this.db.run('BEGIN TRANSACTION', (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            // Clear existing games (we replace all data each time)
            await new Promise((resolve, reject) => {
                this.db.run('DELETE FROM games', (err) => {
                    if (err)
                        reject(err);
                    else {
                        console.log('Cleared existing games from database');
                        resolve();
                    }
                });
            });
            // Insert new games
            for (const game of gameData.games) {
                await new Promise((resolve, reject) => {
                    this.db.run(`INSERT INTO games (field, time, team1, team2, year, game_duration, game_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, [
                        game.field,
                        game.time,
                        game.team1 || '',
                        game.team2 || '',
                        game.year,
                        game.gameDuration,
                        game.gameType
                    ], (err) => {
                        if (err)
                            reject(err);
                        else {
                            gamesInserted++;
                            resolve();
                        }
                    });
                });
            }
            // Update processing log
            await new Promise((resolve, reject) => {
                this.db.run(`UPDATE processing_log 
           SET status = 'completed', games_extracted = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`, [gamesInserted, processingId], (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            // Commit transaction
            await new Promise((resolve, reject) => {
                this.db.run('COMMIT', (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            console.log(`Successfully saved ${gamesInserted} games to database`);
            return gamesInserted;
        }
        catch (error) {
            // Rollback on error
            await new Promise((resolve, reject) => {
                this.db.run('ROLLBACK', (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            console.error('Error saving games data:', error);
            // Update processing log with error
            await new Promise((resolve, reject) => {
                this.db.run(`UPDATE processing_log 
           SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`, [error instanceof Error ? error.message : String(error), processingId], (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            throw error;
        }
    }
    // Get processing history for admin dashboard
    async getProcessingHistory(limit = 20) {
        if (!this.db)
            throw new Error('Database not initialized');
        return new Promise((resolve, reject) => {
            this.db.all(`
        SELECT 
          id, filename, document_date, status, error_message, 
          games_extracted, created_at, updated_at
        FROM processing_log 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                }
                else {
                    // Convert snake_case to camelCase
                    const logs = rows.map(row => ({
                        id: row.id,
                        filename: row.filename,
                        documentDate: row.document_date,
                        status: row.status,
                        error_message: row.error_message,
                        games_extracted: row.games_extracted,
                        created_at: row.created_at,
                        updated_at: row.updated_at
                    }));
                    resolve(logs);
                }
            });
        });
    }
    // Get latest successful processing info
    async getLatestProcessing() {
        if (!this.db)
            throw new Error('Database not initialized');
        return new Promise((resolve, reject) => {
            this.db.get(`
        SELECT 
          id, filename, document_date, status, error_message, 
          games_extracted, created_at, updated_at
        FROM processing_log 
        WHERE status = 'completed'
        ORDER BY created_at DESC 
        LIMIT 1
      `, (err, row) => {
                if (err) {
                    reject(err);
                }
                else if (!row) {
                    resolve(null);
                }
                else {
                    resolve({
                        id: row.id,
                        filename: row.filename,
                        documentDate: row.document_date,
                        status: row.status,
                        error_message: row.error_message,
                        games_extracted: row.games_extracted,
                        created_at: row.created_at,
                        updated_at: row.updated_at
                    });
                }
            });
        });
    }
    // Get games for data checking (matching current functionality)
    async getAllGames() {
        if (!this.db)
            throw new Error('Database not initialized');
        return new Promise((resolve, reject) => {
            this.db.all(`
        SELECT 
          id, field, time, team1, team2, year, 
          game_duration, game_type, created_at, updated_at
        FROM games 
        ORDER BY field, year, time
      `, (err, rows) => {
                if (err) {
                    reject(err);
                }
                else {
                    // Convert snake_case to camelCase
                    const games = rows.map(row => ({
                        id: row.id,
                        field: row.field,
                        time: row.time,
                        team1: row.team1,
                        team2: row.team2,
                        year: row.year,
                        gameDuration: row.game_duration,
                        gameType: row.game_type,
                        created_at: row.created_at,
                        updated_at: row.updated_at
                    }));
                    resolve(games);
                }
            });
        });
    }
    // Get summary statistics
    async getGamesSummary() {
        if (!this.db)
            throw new Error('Database not initialized');
        const [totalGames, fieldCount, missingTeams, latestProcessing] = await Promise.all([
            new Promise((resolve, reject) => {
                this.db.get('SELECT COUNT(*) as count FROM games', (err, row) => {
                    if (err)
                        reject(err);
                    else
                        resolve(row);
                });
            }),
            new Promise((resolve, reject) => {
                this.db.get('SELECT COUNT(DISTINCT field) as count FROM games', (err, row) => {
                    if (err)
                        reject(err);
                    else
                        resolve(row);
                });
            }),
            new Promise((resolve, reject) => {
                this.db.get('SELECT COUNT(*) as count FROM games WHERE team1 = "" OR team2 = ""', (err, row) => {
                    if (err)
                        reject(err);
                    else
                        resolve(row);
                });
            }),
            this.getLatestProcessing()
        ]);
        return {
            totalGames: totalGames?.count || 0,
            totalFields: fieldCount?.count || 0,
            gamesWithMissingTeams: missingTeams?.count || 0,
            latestDocumentDate: latestProcessing?.documentDate || null
        };
    }
    // Export games in the same JSON format as current system (for compatibility)
    async exportGamesAsJSON() {
        if (!this.db)
            throw new Error('Database not initialized');
        const games = await this.getAllGames();
        const latestProcessing = await this.getLatestProcessing();
        // Convert database format back to original JSON format
        const jsonGames = games.map(game => ({
            field: game.field,
            time: game.time,
            team1: game.team1,
            team2: game.team2,
            year: game.year,
            gameDuration: game.gameDuration,
            gameType: game.gameType
        }));
        return {
            documentDate: latestProcessing?.documentDate || 'Unknown',
            games: jsonGames
        };
    }
    // Close database connection
    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((err) => {
                    if (err)
                        console.error('Error closing database:', err);
                    else
                        console.log('Database connection closed');
                    this.db = null;
                    resolve();
                });
            });
        }
    }
}
// Singleton instance
let dbInstance = null;
export async function getDatabase() {
    if (!dbInstance) {
        dbInstance = new AdminDatabase();
        await dbInstance.initialize();
    }
    return dbInstance;
}

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types for main app game data (simplified version)
export interface Game {
  id?: number;
  field: string;
  time: string;
  team1: string;
  team2: string;
  year: string;
  gameDuration: string;
  gameType: string;
  created_at?: string;
  updated_at?: string;
}

// Database row type (with snake_case columns)
interface GameRow {
  id: number;
  field: string;
  time: string;
  team1: string;
  team2: string;
  year: string;
  game_duration: string;
  game_type: string;
  created_at: string;
  updated_at: string;
}

export interface GameData {
  documentDate: string;
  games: Game[];
  sourceFile?: string;
}

export class MainAppDatabase {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor() {
    // Use same persistent storage path as main app
    const persistentStoragePath = process.env.APP_PERSISTENT_STORAGE_PATH || 
      path.join(__dirname, '../persistent_app_files');
    this.dbPath = path.join(persistentStoragePath, 'games.db');
  }

  async initialize(): Promise<void> {
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

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

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
      
      // Metadata table for storing document info
      `CREATE TABLE IF NOT EXISTS metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Indexes for better performance
      `CREATE INDEX IF NOT EXISTS idx_games_team1 ON games(team1)`,
      `CREATE INDEX IF NOT EXISTS idx_games_team2 ON games(team2)`,
      `CREATE INDEX IF NOT EXISTS idx_games_field_time ON games(field, time)`,
      `CREATE INDEX IF NOT EXISTS idx_games_year ON games(year)`
    ];

    for (const sql of tables) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    console.log('Database tables created/verified');
  }

  // Save games data from admin API response
  async saveGamesData(gameData: GameData): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    let gamesInserted = 0;

    try {
      // Start transaction
      await new Promise<void>((resolve, reject) => {
        this.db!.run('BEGIN TRANSACTION', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Clear existing games (we replace all data each time)
      await new Promise<void>((resolve, reject) => {
        this.db!.run('DELETE FROM games', (err) => {
          if (err) reject(err);
          else {
            console.log('Cleared existing games from database');
            resolve();
          }
        });
      });

      // Insert new games
      for (const game of gameData.games) {
        await new Promise<void>((resolve, reject) => {
          this.db!.run(
            `INSERT INTO games (field, time, team1, team2, year, game_duration, game_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              game.field,
              game.time,
              game.team1 || '',
              game.team2 || '',
              game.year,
              game.gameDuration,
              game.gameType
            ],
            (err) => {
              if (err) reject(err);
              else {
                gamesInserted++;
                resolve();
              }
            }
          );
        });
      }

      // Update metadata
      await this.updateMetadata('documentDate', gameData.documentDate);
      if (gameData.sourceFile) {
        await this.updateMetadata('sourceFile', gameData.sourceFile);
      }

      // Commit transaction
      await new Promise<void>((resolve, reject) => {
        this.db!.run('COMMIT', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      console.log(`Successfully saved ${gamesInserted} games to database`);
      return gamesInserted;

    } catch (error) {
      // Rollback on error
      await new Promise<void>((resolve, reject) => {
        this.db!.run('ROLLBACK', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      console.error('Error saving games data:', error);
      throw error;
    }
  }

  // Update metadata (document date, source file)
  private async updateMetadata(key: string, value: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT OR REPLACE INTO metadata (key, value, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [key, value],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Get metadata value
  private async getMetadata(key: string): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.get(
        'SELECT value FROM metadata WHERE key = ?',
        [key],
        (err, row: { value: string } | undefined) => {
          if (err) reject(err);
          else resolve(row?.value || null);
        }
      );
    });
  }

  // Get all games from database
  async getAllGames(): Promise<Game[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.all(`
        SELECT 
          id, field, time, team1, team2, year, 
          game_duration, game_type, created_at, updated_at
        FROM games 
        ORDER BY field, year, time
      `, (err, rows: GameRow[]) => {
        if (err) {
          reject(err);
        } else {
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

  // Get games for a specific team
  async getGamesForTeam(teamName: string): Promise<Game[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.all(`
        SELECT 
          id, field, time, team1, team2, year, 
          game_duration, game_type, created_at, updated_at
        FROM games 
        WHERE team1 = ? OR team2 = ?
        ORDER BY time
      `, [teamName, teamName], (err, rows: GameRow[]) => {
        if (err) {
          reject(err);
        } else {
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

  // Get current data for compatibility with existing code
  async getCurrentGameData(): Promise<GameData> {
    const games = await this.getAllGames();
    const documentDate = await this.getMetadata('documentDate') || 'Unknown';
    const sourceFile = await this.getMetadata('sourceFile');

    return {
      documentDate,
      games,
      sourceFile: sourceFile || undefined
    };
  }

  // Get game count
  async getGameCount(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.get('SELECT COUNT(*) as count FROM games', (err, row: {count: number}) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    });
  }

  // Close database connection
  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve) => {
        this.db!.close((err) => {
          if (err) console.error('Error closing database:', err);
          else console.log('Database connection closed');
          this.db = null;
          resolve();
        });
      });
    }
  }
}

// Singleton instance
let dbInstance: MainAppDatabase | null = null;

export async function getDatabase(): Promise<MainAppDatabase> {
  if (!dbInstance) {
    dbInstance = new MainAppDatabase();
    await dbInstance.initialize();
  }
  return dbInstance;
}

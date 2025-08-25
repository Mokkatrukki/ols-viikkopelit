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
    // SHARED DATABASE: Point to admin app's database
    // In production: both apps will use shared volume/database
    // In local dev: main app reads from admin app's database
    const adminDbPath = process.env.SHARED_GAMES_DB_PATH || 
      path.join(__dirname, '../admin_app/persistent_app_files/games.db');
    
    this.dbPath = adminDbPath;
    console.log(`Main app will read from shared database at: ${this.dbPath}`);
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Open database in READ-ONLY mode since main app only reads
      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          console.error('Failed to open shared database:', err);
          console.error('Make sure admin app has created the database first');
          reject(err);
          return;
        }
        
        console.log(`Main app connected to shared database (READ-ONLY): ${this.dbPath}`);
        // No need to create tables - admin app handles that
        resolve();
      });
    });
  }

  // READ-ONLY OPERATIONS ONLY
  // All write operations are handled by admin app

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
    
    // Get document date from processing_log table (admin app's table)
    let documentDate = 'Unknown';
    let sourceFile: string | undefined;
    
    try {
      const latestProcessing = await new Promise<{document_date: string, filename: string} | undefined>((resolve, reject) => {
        this.db!.get(`
          SELECT document_date, filename
          FROM processing_log 
          WHERE status = 'completed'
          ORDER BY created_at DESC 
          LIMIT 1
        `, (err, row: {document_date: string, filename: string} | undefined) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (latestProcessing) {
        documentDate = latestProcessing.document_date;
        sourceFile = latestProcessing.filename;
      }
    } catch (error) {
      console.warn('Could not read document metadata from processing_log:', error);
    }

    return {
      documentDate,
      games,
      sourceFile
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

interface Game {
    field: string;
    gameDuration: string;
    gameType: string;
    year: string;
    time: string;
    team1: string;
    team2: string;
    date?: string;
    location?: string;
}
interface GameOutput {
    documentDate: string;
    games: Game[];
}
/**
 * Main parser function
 */
declare function parseExcelFile(filePath: string): GameOutput;
export { parseExcelFile, Game, GameOutput };
//# sourceMappingURL=parseExcel.d.ts.map
import type { GameType } from "../../../generated/prisma/client.js";

/** Lista oficial Salsa "Game List TaDa Gaming" — Gator ID + Game Logo (CMS). */
export const TADA_EXCEL_GAMES: Array<{
  code: string;
  name: string;
  providerSlug: string;
  providerName: string;
  categorySlug: "table" | "slots" | "crash" | "instant";
  gameType: GameType;
  thumbnailUrl: string;
}> = [
  { code: "tada-MinesGrand", name: "Mines Grand", thumbnailUrl: "https://cms.salsagator.com/games/52445.png", categorySlug: "crash", gameType: "CRASH", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-10SparklingCrown", name: "10 Sparkling Crown", thumbnailUrl: "https://cms.salsagator.com/games/52446.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-BikiniLady", name: "Bikini Lady", thumbnailUrl: "https://cms.salsagator.com/games/52447.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-CoinTree", name: "Coin Tree", thumbnailUrl: "https://cms.salsagator.com/games/52448.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-CrashPuck", name: "Crash Puck", thumbnailUrl: "https://cms.salsagator.com/games/52449.png", categorySlug: "crash", gameType: "CRASH", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-PirateQueen2", name: "Pirate Queen 2", thumbnailUrl: "https://cms.salsagator.com/games/52450.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-SafariMystery", name: "Safari Mystery", thumbnailUrl: "https://cms.salsagator.com/games/52451.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-EyeStrike", name: "Eye Strike", thumbnailUrl: "https://cms.salsagator.com/games/57225.jpeg", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-FortuneGaruda1000", name: "Fortune Garuda 1000", thumbnailUrl: "https://cms.salsagator.com/games/58137.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-OttomanTreasures", name: "Ottoman Treasures", thumbnailUrl: "https://cms.salsagator.com/games/58182.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-LuckyCerol500", name: "Lucky Cerol 500", thumbnailUrl: "https://cms.salsagator.com/games/59322.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-SupernovaGalaxy", name: "Supernova Galaxy", thumbnailUrl: "https://cms.salsagator.com/games/59332.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-3GoldSeeker", name: "3 Gold Seeker", thumbnailUrl: "https://cms.salsagator.com/games/59333.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-ChickenDashJackpot", name: "Chicken Dash Jackpot", thumbnailUrl: "https://cms.salsagator.com/games/59393.png", categorySlug: "instant", gameType: "INSTANT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-DungeonOfRiches", name: "Dungeon of Riches", thumbnailUrl: "https://cms.salsagator.com/games/59424.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-3LionRoarrr", name: "3 Lion Roarrr", thumbnailUrl: "https://cms.salsagator.com/games/59711.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-CoinofLightning2", name: "Coin of Lightning 2", thumbnailUrl: "https://cms.salsagator.com/games/59877.jpeg", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-CrashFireworks", name: "Crash Fireworks", thumbnailUrl: "https://cms.salsagator.com/games/59897.png", categorySlug: "crash", gameType: "CRASH", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-HighNoon", name: "High Noon", thumbnailUrl: "https://cms.salsagator.com/games/59924.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-3RoyalJoker", name: "3 Royal Joker", thumbnailUrl: "https://cms.salsagator.com/games/59935.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-Eden", name: "Eden", thumbnailUrl: "https://cms.salsagator.com/games/60502.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-GemsofBuxexa", name: "Gems of Buxexa", thumbnailUrl: "https://cms.salsagator.com/games/60841.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-DevilFireBonusCoin", name: "Devil Fire Bonu$ Coin", thumbnailUrl: "https://cms.salsagator.com/games/60842.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-3DragonsCoin", name: "3 Dragons' Coin", thumbnailUrl: "https://cms.salsagator.com/games/61220.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
  { code: "tada-PirateQueen9999", name: "Pirate Queen 9999", thumbnailUrl: "https://cms.salsagator.com/games/61221.png", categorySlug: "slots", gameType: "SLOT", providerSlug: "tada-gaming", providerName: "TaDa Gaming" },
];

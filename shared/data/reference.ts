import type { FranchiseId, Tier, Lakhs, AuctionType } from '../types';

/** Consistent three-letter country codes. `legacy` lists codes/names used by the v2 file. */
export const COUNTRIES: Record<string, { name: string; flag: string; legacy: string[] }> = {
  IND: { name: 'India', flag: '🇮🇳', legacy: ['IND', 'India'] },
  AUS: { name: 'Australia', flag: '🇦🇺', legacy: ['AUS', 'Australia'] },
  ENG: { name: 'England', flag: '🏴', legacy: ['ENG', 'England'] },
  RSA: { name: 'South Africa', flag: '🇿🇦', legacy: ['SA', 'RSA', 'South Africa'] },
  WIN: { name: 'West Indies', flag: '🌴', legacy: ['WI', 'WIN', 'West Indies'] },
  NZL: { name: 'New Zealand', flag: '🇳🇿', legacy: ['NZ', 'NZL', 'New Zealand'] },
  AFG: { name: 'Afghanistan', flag: '🇦🇫', legacy: ['AFG', 'Afghanistan'] },
  SRI: { name: 'Sri Lanka', flag: '🇱🇰', legacy: ['SL', 'SRI', 'Sri Lanka'] },
  BAN: { name: 'Bangladesh', flag: '🇧🇩', legacy: ['BAN', 'Bangladesh'] },
  ZIM: { name: 'Zimbabwe', flag: '🇿🇼', legacy: ['ZIM', 'Zimbabwe'] },
  IRE: { name: 'Ireland', flag: '🇮🇪', legacy: ['IRE', 'Ireland'] },
  NED: { name: 'Netherlands', flag: '🇳🇱', legacy: ['NED', 'Netherlands'] },
  USA: { name: 'United States', flag: '🇺🇸', legacy: ['USA', 'United States'] },
  SCO: { name: 'Scotland', flag: '🏴', legacy: ['SCO', 'Scotland'] },
  NEP: { name: 'Nepal', flag: '🇳🇵', legacy: ['NEP', 'Nepal'] },
};

/** Map any legacy spelling ("SA", "India", "WI" …) to the canonical code, or null if unknown. */
export function normalizeCountry(input: string): string | null {
  const v = input.trim();
  if (COUNTRIES[v.toUpperCase()]) return v.toUpperCase();
  for (const [code, c] of Object.entries(COUNTRIES)) {
    if (c.legacy.some((l) => l.toLowerCase() === v.toLowerCase())) return code;
  }
  return null;
}

export const HOME_COUNTRY = 'IND';

export interface Franchise {
  id: FranchiseId;
  name: string;
  short: string;
  color: string;
  accent: string;
}

export const FRANCHISES: Franchise[] = [
  { id: 'CSK', name: 'Chennai Super Kings', short: 'CSK', color: '#F9CD05', accent: '#0081E9' },
  { id: 'MI', name: 'Mumbai Indians', short: 'MI', color: '#004BA0', accent: '#D1AB3E' },
  { id: 'RCB', name: 'Royal Challengers Bengaluru', short: 'RCB', color: '#EC1C24', accent: '#2B2A29' },
  { id: 'KKR', name: 'Kolkata Knight Riders', short: 'KKR', color: '#6A3FA0', accent: '#F2C230' },
  { id: 'SRH', name: 'Sunrisers Hyderabad', short: 'SRH', color: '#F26522', accent: '#000000' },
  { id: 'RR', name: 'Rajasthan Royals', short: 'RR', color: '#EA1A85', accent: '#254AA5' },
  { id: 'DC', name: 'Delhi Capitals', short: 'DC', color: '#2561AE', accent: '#EF1B23' },
  { id: 'PBKS', name: 'Punjab Kings', short: 'PBKS', color: '#DD1F2D', accent: '#A7A9AC' },
  { id: 'LSG', name: 'Lucknow Super Giants', short: 'LSG', color: '#00AEEF', accent: '#F28B00' },
  { id: 'GT', name: 'Gujarat Titans', short: 'GT', color: '#5B7FB3', accent: '#DBBE6E' },
];

export const FRANCHISE_IDS = FRANCHISES.map((f) => f.id);

export const TIERS: Tier[] = ['diamond', 'platinum', 'gold', 'silver', 'bronze'];

export const TIER_BASE_PRICE: Record<Tier, Lakhs> = {
  diamond: 200,
  platinum: 150,
  gold: 100,
  silver: 50,
  bronze: 20,
};

/** Default rating given to host-created custom players of each tier (fictional). */
export const TIER_DEFAULT_RATING: Record<Tier, number> = {
  diamond: 88,
  platinum: 84,
  gold: 80,
  silver: 76,
  bronze: 72,
};

/** Lowest base price in the game; used for the squad-completion reserve. */
export const MIN_BASE_PRICE: Lakhs = 20;

/** Default purse (lakhs) by auction type and team count – carried over from v2 (values were in Cr). */
export const DEFAULT_PURSE: Record<AuctionType, Record<number, Lakhs>> = {
  mega: { 2: 7000, 3: 7000, 4: 8000, 5: 9000, 6: 10000, 7: 10500, 8: 11000, 9: 11500, 10: 12000 },
  mini: { 2: 3500, 3: 3500, 4: 4000, 5: 4500, 6: 5000, 7: 5200, 8: 5500, 9: 5700, 10: 6000 },
};

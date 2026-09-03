/**
 * Era political geography: which real country (Natural Earth ADM0_A3 code) belongs to which
 * nation at the campaign start, the non-playable AI powers of each era, and dated historical events.
 */
import type { NationDef, NationWeapons, Personality } from './types';

export type EventAction =
  | { type: 'war'; a: string; b: string }
  | { type: 'ally'; a: string; b: string }
  | { type: 'peace'; a: string; b: string }
  | { type: 'stability'; n: string; delta: number };

export interface HistoricalEvent {
  date: string; // YYYY-MM-DD
  title: string;
  text: string;
  actions: EventAction[];
}

export interface EraPolitics {
  territory: Record<string, string>;
  aiNations: NationDef[];
  events: HistoricalEvent[];
}

const T = (nation: string, codes: string) => Object.fromEntries(codes.trim().split(/\s+/).map((c) => [c, nation]));

function ai(
  id: string,
  name: string,
  adjective: string,
  color: number,
  capital: [number, number, string],
  bloc: string,
  weapons: NationWeapons,
  opts: Partial<NationDef> & { industry?: number; manpower?: number; personality?: Personality } = {},
): NationDef {
  return {
    id,
    name,
    adjective,
    color,
    capital: { lat: capital[0], lon: capital[1], name: capital[2] },
    size: 0,
    industry: opts.industry ?? 0.6,
    manpower: opts.manpower ?? 0.8,
    personality: opts.personality ?? 'cautious',
    bloc,
    description: opts.description ?? '',
    strengths: opts.strengths ?? [],
    weapons,
    tankName: opts.tankName ?? 'Armoured car',
    planeName: opts.planeName ?? 'Biplane',
    playable: false,
    flag: opts.flag ?? { colors: [color, 0xffffff] },
    holdings: opts.holdings,
    armies: opts.armies,
  };
}

// ----------------------------------------------------------------------------- WWI (August 1914)
const ww1Territory: Record<string, string> = {
  ...T('britain', 'GBR IRL CAN AUS NZL IND PAK BGD LKA MMR MYS BRN ZAF EGY SDN SDS KEN UGA NGA GHA SLE GMB ZMB ZWE MWI BWA LSO SWZ CYP JAM TTO GUY BLZ FJI SLB VUT KWT SOL FLK'),
  ...T('france', 'FRA DZA TUN MAR MRT MLI NER TCD SEN GIN CIV BFA BEN GAB COG CAF MDG DJI VNM LAO KHM NCL ATF'),
  ...T('germany', 'DEU NAM TZA CMR TGO RWA BDI PNG'),
  ...T('russia', 'RUS POL FIN EST LVA LTU BLR UKR MDA GEO ARM AZE KAZ UZB TKM KGZ TJK'),
  ...T('ottoman', 'TUR SYR LBN ISR PSX JOR IRQ YEM'),
  ...T('usa', 'USA PHL PRI'),
  ...T('austria', 'AUT HUN CZE SVK HRV BIH SVN'),
  ...T('italy', 'ITA LBY ERI SOM'),
  ...T('japan', 'JPN KOR PRK TWN'),
  ...T('serbia', 'SRB MNE KOS'),
  ...T('belgium', 'BEL COD'),
  ...T('romania', 'ROU'),
  ...T('bulgaria', 'BGR MKD'),
  ...T('greece', 'GRC'),
  ...T('portugal', 'PRT AGO MOZ GNB TLS'),
  ...T('china', 'CHN'),
  ...T('netherlands', 'NLD IDN SUR'),
  ...T('spain', 'ESP SAH GNQ'),
  ...T('denmark', 'DNK ISL GRL'),
};

const ww1Ai: NationDef[] = [
  ai('austria', 'Austria-Hungary', 'Austro-Hungarian', 0xd9c46a, [48.2, 16.37, 'Vienna'], 'central', { rifle: 'gewehr98', lmg: 'mg08', pistol: 'c96' }, { industry: 0.8, manpower: 1.1, personality: 'aggressive', armies: 6, flag: { colors: [0x000000, 0xf5d020] }, tankName: 'Austro-Daimler', planeName: 'Aviatik D.I' }),
  ai('italy', 'Kingdom of Italy', 'Italian', 0x4cae6f, [41.9, 12.5, 'Rome'], 'neutral', { rifle: 'lebel', lmg: 'chauchat', pistol: 'c96' }, { industry: 0.7, manpower: 0.9, personality: 'opportunist', armies: 4, flag: { colors: [0x009246, 0xffffff, 0xce2b37], dir: 'v' }, tankName: 'Fiat 2000', planeName: 'Ansaldo SVA' }),
  ai('japan', 'Empire of Japan', 'Japanese', 0xe8c04a, [35.68, 139.7, 'Tokyo'], 'entente', { rifle: 'mosin', lmg: 'lewis', pistol: 'nagant' }, { industry: 0.7, manpower: 0.9, personality: 'opportunist', flag: { colors: [0xffffff, 0xbc002d, 0xffffff] }, tankName: 'Mark IV', planeName: 'Sopwith Camel' }),
  ai('serbia', 'Kingdom of Serbia', 'Serbian', 0x8a6db8, [44.8, 20.47, 'Belgrade'], 'entente', { rifle: 'mosin', lmg: 'lewis', pistol: 'nagant' }, { industry: 0.3, manpower: 0.7, personality: 'cautious', flag: { colors: [0xc6363c, 0x0c4076, 0xffffff] } }),
  ai('belgium', 'Belgium', 'Belgian', 0xd4a35a, [50.85, 4.35, 'Brussels'], 'entente', { rifle: 'lebel', lmg: 'lewis', pistol: 'c96' }, { industry: 0.6, manpower: 0.5, personality: 'cautious', flag: { colors: [0x000000, 0xfae042, 0xed2939], dir: 'v' } }),
  ai('romania', 'Romania', 'Romanian', 0x6fa8dc, [44.43, 26.1, 'Bucharest'], 'neutral', { rifle: 'mosin', lmg: 'lewis', pistol: 'nagant' }, { industry: 0.35, manpower: 0.7, flag: { colors: [0x002b7f, 0xfcd116, 0xce1126], dir: 'v' } }),
  ai('bulgaria', 'Bulgaria', 'Bulgarian', 0x7fbf7f, [42.7, 23.32, 'Sofia'], 'neutral', { rifle: 'gewehr98', lmg: 'mg08', pistol: 'luger' }, { industry: 0.3, manpower: 0.6, flag: { colors: [0xffffff, 0x00966e, 0xd62612] } }),
  ai('greece', 'Greece', 'Greek', 0x5b9bd5, [37.98, 23.73, 'Athens'], 'neutral', { rifle: 'lebel', lmg: 'lewis', pistol: 'webley' }, { industry: 0.3, manpower: 0.5, flag: { colors: [0x0d5eaf, 0xffffff, 0x0d5eaf] } }),
  ai('portugal', 'Portugal', 'Portuguese', 0x3f8f5f, [38.72, -9.14, 'Lisbon'], 'neutral', { rifle: 'lee_enfield', lmg: 'lewis', pistol: 'webley' }, { industry: 0.35, manpower: 0.5, flag: { colors: [0x006600, 0xff0000], dir: 'v' } }),
  ai('china', 'Republic of China', 'Chinese', 0xc9a7c2, [39.9, 116.4, 'Beijing'], 'neutral', { rifle: 'gewehr98', lmg: 'mg08', pistol: 'c96' }, { industry: 0.4, manpower: 1.5, flag: { colors: [0xff0000, 0xffff00, 0x0000ff, 0xffffff, 0x000000] } }),
  ai('netherlands', 'Netherlands', 'Dutch', 0xf29e4c, [52.37, 4.9, 'Amsterdam'], 'neutral', { rifle: 'gewehr98', lmg: 'lewis', pistol: 'luger' }, { industry: 0.6, manpower: 0.5, flag: { colors: [0xae1c28, 0xffffff, 0x21468b] } }),
  ai('spain', 'Spain', 'Spanish', 0xd98c4a, [40.42, -3.7, 'Madrid'], 'neutral', { rifle: 'gewehr98', lmg: 'chauchat', pistol: 'c96' }, { industry: 0.45, manpower: 0.7, flag: { colors: [0xaa151b, 0xf1bf00, 0xaa151b] } }),
  ai('denmark', 'Denmark', 'Danish', 0xc06070, [55.68, 12.57, 'Copenhagen'], 'neutral', { rifle: 'gewehr98', lmg: 'lewis', pistol: 'luger' }, { industry: 0.4, manpower: 0.3, flag: { colors: [0xc60c30, 0xffffff, 0xc60c30] } }),
];

const ww1Events: HistoricalEvent[] = [
  { date: '1914-11-02', title: 'The Ottoman Empire enters the war', text: 'Ottoman warships shell Russian ports. Constantinople joins the Central Powers.', actions: [{ type: 'war', a: 'ottoman', b: 'russia' }, { type: 'war', a: 'ottoman', b: 'britain' }, { type: 'war', a: 'ottoman', b: 'france' }, { type: 'ally', a: 'ottoman', b: 'germany' }] },
  { date: '1915-05-23', title: 'Italy joins the Entente', text: 'Rome declares war on Austria-Hungary after the secret Treaty of London.', actions: [{ type: 'ally', a: 'italy', b: 'britain' }, { type: 'ally', a: 'italy', b: 'france' }, { type: 'war', a: 'italy', b: 'austria' }] },
  { date: '1915-10-14', title: 'Bulgaria joins the Central Powers', text: 'Sofia attacks Serbia from the east.', actions: [{ type: 'ally', a: 'bulgaria', b: 'germany' }, { type: 'ally', a: 'bulgaria', b: 'austria' }, { type: 'war', a: 'bulgaria', b: 'serbia' }, { type: 'war', a: 'bulgaria', b: 'russia' }] },
  { date: '1916-03-09', title: 'Portugal at war', text: 'Germany declares war on Portugal after Lisbon seizes German ships.', actions: [{ type: 'ally', a: 'portugal', b: 'britain' }, { type: 'war', a: 'germany', b: 'portugal' }] },
  { date: '1916-08-27', title: 'Romania joins the Entente', text: 'Bucharest invades Transylvania.', actions: [{ type: 'ally', a: 'romania', b: 'russia' }, { type: 'war', a: 'romania', b: 'austria' }, { type: 'war', a: 'romania', b: 'germany' }] },
  { date: '1917-03-15', title: 'February Revolution', text: 'The Tsar abdicates. Russia reels.', actions: [{ type: 'stability', n: 'russia', delta: -25 }] },
  { date: '1917-04-06', title: 'The United States enters the war', text: 'Congress declares war on Germany after unrestricted submarine warfare resumes.', actions: [{ type: 'ally', a: 'usa', b: 'britain' }, { type: 'ally', a: 'usa', b: 'france' }, { type: 'war', a: 'usa', b: 'germany' }] },
  { date: '1917-06-27', title: 'Greece joins the Entente', text: 'Venizelos brings Greece into the war.', actions: [{ type: 'ally', a: 'greece', b: 'britain' }, { type: 'war', a: 'greece', b: 'bulgaria' }, { type: 'war', a: 'greece', b: 'germany' }] },
  { date: '1917-11-07', title: 'October Revolution', text: 'The Bolsheviks seize Petrograd. Russia collapses into civil war.', actions: [{ type: 'stability', n: 'russia', delta: -30 }] },
];

// ----------------------------------------------------------------------------- WWII (December 1941)
const ww2Territory: Record<string, string> = {
  ...T('germany', 'DEU AUT CZE POL FRA BEL NLD LUX DNK NOR SVK SVN HRV SRB MNE BIH GRC EST LVA LTU BLR UKR KOS'),
  ...T('italy', 'ITA ALB LBY'),
  ...T('japan', 'JPN KOR PRK TWN'),
  ...T('ussr', 'RUS KAZ UZB TKM KGZ TJK GEO ARM AZE MNG'),
  ...T('uk', 'GBR CAN AUS NZL IND PAK BGD LKA MMR MYS BRN SGP ZAF EGY SDN SDS KEN UGA TZA NGA GHA SLE GMB ZMB ZWE MWI BWA LSO SWZ CYP ISR PSX JOR IRQ SYR LBN IRN KWT SOM ERI ETH GAB COG CAF TCD CMR ISL JAM TTO GUY BLZ FJI PNG SLB VUT SOL FLK'),
  ...T('usa', 'USA PHL PRI GRL'),
  ...T('china', 'CHN'),
  ...T('finland', 'FIN'),
  ...T('hungary', 'HUN'),
  ...T('romania', 'ROU MDA'),
  ...T('bulgaria', 'BGR MKD'),
  ...T('vichy', 'DZA TUN MAR MRT MLI NER SEN GIN CIV BFA BEN TGO MDG DJI VNM LAO KHM NCL ATF'),
  ...T('spain', 'ESP SAH GNQ'),
  ...T('portugal', 'PRT AGO MOZ GNB TLS'),
  ...T('turkey', 'TUR'),
  ...T('sweden', 'SWE'),
  ...T('brazil', 'BRA'),
  ...T('netherlands', 'IDN SUR'),
};

const ww2Ai: NationDef[] = [
  ai('italy', 'Kingdom of Italy', 'Italian', 0x4cae6f, [41.9, 12.5, 'Rome'], 'axis', { rifle: 'kar98k', lmg: 'bren', smg: 'mp40', pistol: 'p38' }, { industry: 0.7, manpower: 0.9, personality: 'opportunist', armies: 5, flag: { colors: [0x009246, 0xffffff, 0xce2b37], dir: 'v' }, tankName: 'M13/40', planeName: 'Macchi C.202' }),
  ai('china', 'Republic of China', 'Chinese', 0x3c78b4, [30.58, 114.3, 'Chongqing'], 'allies', { rifle: 'kar98k', lmg: 'bren', smg: 'thompson', pistol: 'c96' }, { industry: 0.35, manpower: 1.6, personality: 'cautious', armies: 6, flag: { colors: [0xde2910, 0x000095, 0xde2910] }, tankName: 'T-26', planeName: 'P-40 Warhawk' }),
  ai('finland', 'Finland', 'Finnish', 0xb9cbe6, [60.17, 24.94, 'Helsinki'], 'axis', { rifle: 'mosin', lmg: 'dp28', smg: 'ppsh', pistol: 'tt33' }, { industry: 0.4, manpower: 0.5, personality: 'cautious', flag: { colors: [0xffffff, 0x003580, 0xffffff] } }),
  ai('hungary', 'Hungary', 'Hungarian', 0x7f9f5f, [47.5, 19.04, 'Budapest'], 'axis', { rifle: 'kar98k', lmg: 'mg42', smg: 'mp40', pistol: 'p38' }, { industry: 0.45, manpower: 0.6, flag: { colors: [0xce2939, 0xffffff, 0x477050] } }),
  ai('romania', 'Romania', 'Romanian', 0x6fa8dc, [44.43, 26.1, 'Bucharest'], 'axis', { rifle: 'kar98k', lmg: 'mg42', smg: 'mp40', pistol: 'p38' }, { industry: 0.45, manpower: 0.8, flag: { colors: [0x002b7f, 0xfcd116, 0xce1126], dir: 'v' } }),
  ai('bulgaria', 'Bulgaria', 'Bulgarian', 0x7fbf7f, [42.7, 23.32, 'Sofia'], 'axis', { rifle: 'kar98k', lmg: 'mg42', smg: 'mp40', pistol: 'p38' }, { industry: 0.3, manpower: 0.6, flag: { colors: [0xffffff, 0x00966e, 0xd62612] } }),
  ai('vichy', 'Vichy France', 'Vichy French', 0x8c97b8, [46.13, 3.43, 'Vichy'], 'neutral', { rifle: 'lebel', lmg: 'chauchat', smg: 'sten', pistol: 'c96' }, { industry: 0.5, manpower: 0.6, flag: { colors: [0x0055a4, 0xffffff, 0xef4135], dir: 'v' }, tankName: 'Somua S35', planeName: 'Dewoitine D.520' }),
  ai('spain', 'Spain', 'Spanish', 0xd98c4a, [40.42, -3.7, 'Madrid'], 'neutral', { rifle: 'kar98k', lmg: 'mg42', smg: 'mp40', pistol: 'p38' }, { industry: 0.4, manpower: 0.7, flag: { colors: [0xaa151b, 0xf1bf00, 0xaa151b] } }),
  ai('portugal', 'Portugal', 'Portuguese', 0x3f8f5f, [38.72, -9.14, 'Lisbon'], 'neutral', { rifle: 'no4', lmg: 'bren', smg: 'sten', pistol: 'webley' }, { industry: 0.3, manpower: 0.4, flag: { colors: [0x006600, 0xff0000], dir: 'v' } }),
  ai('turkey', 'Turkey', 'Turkish', 0xc75b5b, [39.93, 32.86, 'Ankara'], 'neutral', { rifle: 'kar98k', lmg: 'mg42', smg: 'mp40', pistol: 'p38' }, { industry: 0.4, manpower: 0.8, flag: { colors: [0xe30a17, 0xffffff, 0xe30a17] } }),
  ai('sweden', 'Sweden', 'Swedish', 0x6f9fd8, [59.33, 18.07, 'Stockholm'], 'neutral', { rifle: 'kar98k', lmg: 'bren', smg: 'sten', pistol: 'p38' }, { industry: 0.6, manpower: 0.4, flag: { colors: [0x006aa7, 0xfecc00, 0x006aa7] } }),
  ai('brazil', 'Brazil', 'Brazilian', 0x5fbf6f, [-22.9, -43.2, 'Rio de Janeiro'], 'neutral', { rifle: 'garand', lmg: 'bar', smg: 'thompson', pistol: 'm1911' }, { industry: 0.45, manpower: 0.9, flag: { colors: [0x009c3b, 0xffdf00, 0x009c3b] } }),
  ai('netherlands', 'Dutch East Indies', 'Dutch', 0xf29e4c, [-6.2, 106.8, 'Batavia'], 'allies', { rifle: 'no4', lmg: 'bren', smg: 'sten', pistol: 'webley' }, { industry: 0.3, manpower: 0.5, flag: { colors: [0xae1c28, 0xffffff, 0x21468b] } }),
];

const ww2Events: HistoricalEvent[] = [
  { date: '1942-01-10', title: 'Japan strikes the Dutch East Indies', text: 'The oil fields of Borneo and Sumatra are the prize.', actions: [{ type: 'war', a: 'japan', b: 'netherlands' }] },
  { date: '1942-08-22', title: 'Brazil joins the Allies', text: 'After U-boat attacks on its shipping, Brazil declares war on Germany and Italy.', actions: [{ type: 'ally', a: 'brazil', b: 'usa' }, { type: 'war', a: 'brazil', b: 'germany' }, { type: 'war', a: 'brazil', b: 'italy' }] },
  { date: '1942-11-11', title: 'Case Anton', text: 'German troops occupy Vichy France. The colonies drift to the Allies.', actions: [{ type: 'stability', n: 'vichy', delta: -40 }] },
  { date: '1943-09-08', title: 'Italy surrenders', text: 'The Badoglio government signs an armistice. The Italian state collapses.', actions: [{ type: 'stability', n: 'italy', delta: -50 }] },
  { date: '1944-08-23', title: 'Romania switches sides', text: 'King Michael arrests Antonescu and turns the army against Germany.', actions: [{ type: 'peace', a: 'romania', b: 'ussr' }, { type: 'ally', a: 'romania', b: 'ussr' }, { type: 'war', a: 'romania', b: 'germany' }] },
  { date: '1944-09-19', title: 'Moscow Armistice', text: 'Finland leaves the war against the Soviet Union.', actions: [{ type: 'peace', a: 'finland', b: 'ussr' }] },
  { date: '1945-02-23', title: 'Turkey declares war', text: 'Ankara joins the Allies in the closing months.', actions: [{ type: 'ally', a: 'turkey', b: 'uk' }, { type: 'war', a: 'turkey', b: 'germany' }] },
];

// ----------------------------------------------------------------------------- Present day (2026)
const modernTerritory: Record<string, string> = {
  ...T('nato', 'ALB BEL BGR HRV CZE DNK EST FIN FRA DEU GRC HUN ISL ITA LVA LTU LUX MNE NLD MKD NOR POL PRT ROU SVK SVN ESP SWE GBR CAN GRL ATF FLK'),
  ...T('usa', 'USA PRI'),
  ...T('china', 'CHN'),
  ...T('russia', 'RUS'),
  ...T('regional', 'IRN IRQ SYR'),
  ...T('india', 'IND'),
  ...T('japan', 'JPN'),
  ...T('skorea', 'KOR'),
  ...T('nkorea', 'PRK'),
  ...T('turkey', 'TUR CYN'),
  ...T('ukraine', 'UKR'),
  ...T('israel', 'ISR PSX'),
  ...T('saudi', 'SAU ARE QAT KWT OMN'),
  ...T('pakistan', 'PAK'),
  ...T('australia', 'AUS NZL PNG'),
  ...T('belarus', 'BLR'),
  ...T('taiwan', 'TWN'),
  ...T('brazil', 'BRA'),
  ...T('egypt', 'EGY'),
  ...T('indonesia', 'IDN'),
  ...T('vietnam', 'VNM'),
  ...T('nigeria', 'NGA'),
  ...T('safrica', 'ZAF'),
  ...T('kazakhstan', 'KAZ'),
};

const modW = { rifle: 'ak103', lmg: 'pkm', dmr: 'svd', pistol: 'glock17' };
const modWest = { rifle: 'm4a1', lmg: 'm249', dmr: 'm110', pistol: 'glock17' };
const modernAi: NationDef[] = [
  ai('india', 'India', 'Indian', 0xf5a04a, [28.6, 77.2, 'New Delhi'], 'nonaligned', modW, { industry: 1.0, manpower: 1.6, personality: 'cautious', armies: 6, flag: { colors: [0xff9933, 0xffffff, 0x138808] }, tankName: 'T-90 Bhishma', planeName: 'Rafale' }),
  ai('japan', 'Japan', 'Japanese', 0xe8c04a, [35.68, 139.7, 'Tokyo'], 'west', modWest, { industry: 1.1, manpower: 0.6, flag: { colors: [0xffffff, 0xbc002d, 0xffffff] }, tankName: 'Type 10', planeName: 'F-35A' }),
  ai('skorea', 'South Korea', 'Korean', 0x6fb0e0, [37.57, 126.98, 'Seoul'], 'west', modWest, { industry: 1.0, manpower: 0.6, flag: { colors: [0xffffff, 0xcd2e3a, 0x0047a0] }, tankName: 'K2 Black Panther', planeName: 'KF-21' }),
  ai('nkorea', 'North Korea', 'North Korean', 0x8b3a3a, [39.02, 125.75, 'Pyongyang'], 'east', modW, { industry: 0.3, manpower: 1.0, personality: 'aggressive', flag: { colors: [0x024fa2, 0xed1c27, 0x024fa2] }, tankName: 'Chonma-ho', planeName: 'MiG-29' }),
  ai('turkey', 'Türkiye', 'Turkish', 0xc75b5b, [39.93, 32.86, 'Ankara'], 'west', modWest, { industry: 0.8, manpower: 0.9, personality: 'opportunist', flag: { colors: [0xe30a17, 0xffffff, 0xe30a17] }, tankName: 'Altay', planeName: 'F-16' }),
  ai('ukraine', 'Ukraine', 'Ukrainian', 0x6fa0d8, [50.45, 30.52, 'Kyiv'], 'west', modWest, { industry: 0.5, manpower: 0.9, personality: 'cautious', armies: 4, flag: { colors: [0x0057b7, 0xffd700] }, tankName: 'Leopard 2', planeName: 'F-16' }),
  ai('israel', 'Israel', 'Israeli', 0x7fb2e6, [31.77, 35.21, 'Jerusalem'], 'west', modWest, { industry: 0.9, manpower: 0.4, personality: 'aggressive', flag: { colors: [0xffffff, 0x0038b8, 0xffffff] }, tankName: 'Merkava IV', planeName: 'F-35I' }),
  ai('saudi', 'Gulf Cooperation Council', 'Gulf', 0x3f9f5f, [24.7, 46.7, 'Riyadh'], 'nonaligned', modWest, { industry: 0.7, manpower: 0.5, flag: { colors: [0x006c35, 0xffffff, 0x006c35] }, tankName: 'M1A2S', planeName: 'F-15SA' }),
  ai('pakistan', 'Pakistan', 'Pakistani', 0x4f8f4f, [33.7, 73.05, 'Islamabad'], 'east', modW, { industry: 0.4, manpower: 1.2, flag: { colors: [0xffffff, 0x01411c], dir: 'v' }, tankName: 'Al-Khalid', planeName: 'JF-17' }),
  ai('australia', 'Australia & New Zealand', 'Australian', 0x4f6fbf, [-35.28, 149.13, 'Canberra'], 'west', modWest, { industry: 0.8, manpower: 0.4, flag: { colors: [0x00008b, 0xffffff, 0xff0000] }, tankName: 'M1A2', planeName: 'F-35A' }),
  ai('belarus', 'Belarus', 'Belarusian', 0x6b8f5f, [53.9, 27.57, 'Minsk'], 'east', modW, { industry: 0.4, manpower: 0.5, flag: { colors: [0xc8313e, 0x4aa657] }, tankName: 'T-72B', planeName: 'Su-30' }),
  ai('taiwan', 'Taiwan', 'Taiwanese', 0x5f8fd8, [25.03, 121.56, 'Taipei'], 'west', modWest, { industry: 0.9, manpower: 0.4, flag: { colors: [0x0000aa, 0xfe0000] }, tankName: 'M1A2T', planeName: 'F-16V' }),
  ai('brazil', 'Brazil', 'Brazilian', 0x5fbf6f, [-15.79, -47.88, 'Brasília'], 'nonaligned', modW, { industry: 0.7, manpower: 1.0, flag: { colors: [0x009c3b, 0xffdf00, 0x009c3b] }, tankName: 'Leopard 1A5', planeName: 'Gripen' }),
  ai('egypt', 'Egypt', 'Egyptian', 0xd9b36a, [30.04, 31.24, 'Cairo'], 'nonaligned', modW, { industry: 0.5, manpower: 1.0, flag: { colors: [0xce1126, 0xffffff, 0x000000] }, tankName: 'M1A1', planeName: 'Rafale' }),
  ai('indonesia', 'Indonesia', 'Indonesian', 0xd97a7a, [-6.2, 106.8, 'Jakarta'], 'nonaligned', modW, { industry: 0.5, manpower: 1.2, flag: { colors: [0xff0000, 0xffffff] }, tankName: 'Leopard 2RI', planeName: 'Su-30' }),
  ai('vietnam', 'Vietnam', 'Vietnamese', 0xc85a4a, [21.03, 105.85, 'Hanoi'], 'nonaligned', modW, { industry: 0.4, manpower: 0.9, flag: { colors: [0xda251d, 0xffff00, 0xda251d] }, tankName: 'T-90S', planeName: 'Su-30MK2' }),
  ai('nigeria', 'Nigeria', 'Nigerian', 0x4fa060, [9.06, 7.49, 'Abuja'], 'nonaligned', modW, { industry: 0.35, manpower: 1.1, flag: { colors: [0x008751, 0xffffff, 0x008751], dir: 'v' } }),
  ai('safrica', 'South Africa', 'South African', 0xb08a4a, [-25.75, 28.19, 'Pretoria'], 'nonaligned', modW, { industry: 0.5, manpower: 0.6, flag: { colors: [0x007a4d, 0xffb612, 0xde3831] } }),
  ai('kazakhstan', 'Kazakhstan', 'Kazakh', 0x5fb0c0, [51.17, 71.43, 'Astana'], 'nonaligned', modW, { industry: 0.4, manpower: 0.4, flag: { colors: [0x00afca, 0xfec50c, 0x00afca] } }),
];

const modernEvents: HistoricalEvent[] = [
  { date: '2026-06-15', title: 'Pacific mobilisation', text: 'Japan and South Korea place their forces on a war footing alongside the United States.', actions: [{ type: 'ally', a: 'japan', b: 'usa' }, { type: 'ally', a: 'skorea', b: 'usa' }] },
  { date: '2026-09-01', title: 'Northern axis', text: 'Pyongyang and Minsk sign mutual-defence pacts with Beijing and Moscow.', actions: [{ type: 'ally', a: 'nkorea', b: 'china' }, { type: 'ally', a: 'belarus', b: 'russia' }] },
];

export const POLITICS: Record<string, EraPolitics> = {
  ww1: { territory: ww1Territory, aiNations: ww1Ai, events: ww1Events },
  ww2: { territory: ww2Territory, aiNations: ww2Ai, events: ww2Events },
  modern: { territory: modernTerritory, aiNations: modernAi, events: modernEvents },
};

/** Countries treated as permanent ice / uninhabitable. */
export const ICE_COUNTRIES = new Set(['ATA']);

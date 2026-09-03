import type { EraDef, NationDef, TechDef, TechBranch } from './types';
import { WEAPONS } from './weapons';

const t = (id: string, name: string, branch: TechBranch, tier: number, desc: string, effects: TechDef['effects']): TechDef => ({
  id,
  name,
  branch,
  tier,
  cost: [0, 120, 260, 480, 800][tier],
  desc,
  effects,
});

// ------------------------------------------------------------------ WWI
const ww1Nations: NationDef[] = [
  {
    id: 'britain', name: 'British Empire', adjective: 'British', color: 0xd23c3c,
    capital: { lat: 51.5, lon: -0.13, name: 'London' }, size: 7, industry: 1.1, manpower: 1.0,
    personality: 'cautious', bloc: 'entente',
    description: 'Master of the seas with a global empire. Strong industry, professional army, slow to mobilise.',
    strengths: ['+10% steel', 'Superior naval logistics', 'Lewis gun squads'],
    weapons: { rifle: 'lee_enfield', lmg: 'lewis', pistol: 'webley' }, tankName: 'Mark IV', planeName: 'Sopwith Camel',
  },
  {
    id: 'france', name: 'France', adjective: 'French', color: 0x3d6fd6,
    capital: { lat: 48.86, lon: 2.35, name: 'Paris' }, size: 7, industry: 0.95, manpower: 1.0,
    personality: 'cautious', bloc: 'entente',
    description: 'Holding the Western Front. Elan and artillery doctrine, but vulnerable heartland.',
    strengths: ['+1 artillery strike', 'Fortification bonus', 'Chauchat gunners'],
    weapons: { rifle: 'lebel', lmg: 'chauchat', pistol: 'c96' }, tankName: 'Renault FT', planeName: 'SPAD XIII',
  },
  {
    id: 'germany', name: 'German Empire', adjective: 'German', color: 0x5d5d66,
    capital: { lat: 52.52, lon: 13.4, name: 'Berlin' }, size: 8, industry: 1.2, manpower: 1.0,
    personality: 'aggressive', bloc: 'central',
    description: 'Best-trained army in the world, fighting on two fronts. Industry and doctrine are your edge.',
    strengths: ['+20% industry', 'Stormtrooper tactics', 'MG 08/15 squads'],
    weapons: { rifle: 'gewehr98', lmg: 'mg08', smg: 'mp18', pistol: 'luger' }, tankName: 'A7V', planeName: 'Fokker Dr.I',
  },
  {
    id: 'russia', name: 'Russian Empire', adjective: 'Russian', color: 0x3a9d4f,
    capital: { lat: 55.75, lon: 37.6, name: 'Moscow' }, size: 14, industry: 0.7, manpower: 1.6,
    personality: 'opportunist', bloc: 'entente',
    description: 'Endless manpower and endless land, but a creaking industry and fragile stability.',
    strengths: ['+60% manpower', 'Vast territory', 'Low stability'],
    weapons: { rifle: 'mosin', lmg: 'lewis', pistol: 'nagant' }, tankName: 'Austin Armoured Car', planeName: 'Nieuport 17',
  },
  {
    id: 'ottoman', name: 'Ottoman Empire', adjective: 'Ottoman', color: 0xe0a030,
    capital: { lat: 41.0, lon: 28.97, name: 'Constantinople' }, size: 8, industry: 0.6, manpower: 1.1,
    personality: 'cautious', bloc: 'central',
    description: 'The sick man of Europe fights back. Defensive terrain, tough soldiers, weak factories.',
    strengths: ['Defensive bonus', 'Desert warfare', 'Low industry'],
    weapons: { rifle: 'gewehr98', lmg: 'mg08', pistol: 'c96' }, tankName: 'Captured Mark IV', planeName: 'Albatros D.III',
  },
  {
    id: 'usa', name: 'United States', adjective: 'American', color: 0x4fb3d9,
    capital: { lat: 38.9, lon: -77.0, name: 'Washington' }, size: 11, industry: 1.4, manpower: 1.2,
    personality: 'opportunist', bloc: 'entente',
    description: 'An ocean away from the fighting with the largest industry on Earth. Arrive late, arrive strong.',
    strengths: ['+40% industry', 'Isolated from enemies', 'Long sea lanes'],
    weapons: { rifle: 'springfield', lmg: 'lewis', pistol: 'm1911' }, tankName: 'Renault FT', planeName: 'SPAD XIII',
  },
];

const ww1Techs: TechDef[] = [
  t('ww1_inf1', 'Rifle Drill', 'infantry', 1, 'Marksmanship training. +10% infantry combat, allied AI accuracy up.', { infantry: 0.1 }),
  t('ww1_inf2', 'Light Machine Guns', 'infantry', 2, 'Issue portable automatic weapons to line infantry. Unlocks the Machine Gunner kit.', { unlockKit: 'mg', infantry: 0.05 }),
  t('ww1_inf3', 'Gas Warfare', 'infantry', 3, 'Chemical shells for the artillery park. Enemy troops suffer under gas; your men get masks.', { gas: true, infantry: 0.1 }),
  t('ww1_inf4', 'Infiltration Tactics', 'infantry', 4, 'Stormtrooper doctrine. Unlocks the Trench Raider SMG kit and +20% infantry combat.', { unlockKit: 'smg', infantry: 0.2, org: 0.2 }),
  t('ww1_arm1', 'Heavy Artillery', 'armor', 1, 'Corps-level heavy guns. +1 artillery strike per battle.', { artillery: 1 }),
  t('ww1_arm2', 'Creeping Barrage', 'armor', 2, 'Timed rolling barrages. +2 artillery strikes, +10% attack.', { artillery: 2, infantry: 0.1 }),
  t('ww1_arm3', 'Landships', 'armor', 3, 'The first tanks. Unlocks the Tank Commander kit.', { tank: true, unlockKit: 'tank' }),
  t('ww1_arm4', 'Air Corps', 'armor', 4, 'Ground-attack biplanes. +1 air support call.', { air: 1 }),
  t('ww1_ind1', 'War Economy', 'industry', 1, 'Redirect civilian production. +20% steel.', { steel: 0.2 }),
  t('ww1_ind2', 'Shell Production', 'industry', 2, 'Solve the shell crisis. +30% munitions.', { munitions: 0.3 }),
  t('ww1_ind3', 'Assembly Lines', 'industry', 3, 'Standardised parts. Weapons jam 50% less, +1 medkit.', { jam: 0.5, medkits: 1 }),
  t('ww1_ind4', 'Total Mobilisation', 'industry', 4, 'Everything for the front. +25% manpower, +25% research, +20% steel.', { manpower: 0.25, research: 0.25, steel: 0.2 }),
];

// ------------------------------------------------------------------ WWII
const ww2Nations: NationDef[] = [
  {
    id: 'usa', name: 'United States', adjective: 'American', color: 0x4fb3d9,
    capital: { lat: 38.9, lon: -77.0, name: 'Washington' }, size: 12, industry: 1.6, manpower: 1.2,
    personality: 'opportunist', bloc: 'allies',
    description: 'The Arsenal of Democracy. Unmatched industry and air power once mobilised.',
    strengths: ['+60% industry', 'Air superiority', 'M1 Garand'],
    weapons: { rifle: 'garand', lmg: 'bar', smg: 'thompson', pistol: 'm1911' }, tankName: 'M4 Sherman', planeName: 'P-51 Mustang',
  },
  {
    id: 'uk', name: 'United Kingdom', adjective: 'British', color: 0xd85a5a,
    capital: { lat: 51.5, lon: -0.13, name: 'London' }, size: 7, industry: 1.1, manpower: 0.9,
    personality: 'cautious', bloc: 'allies',
    description: 'Alone at first, then the launchpad for liberation. Strong navy and bombers.',
    strengths: ['Naval logistics', 'Radar research', 'Bren gunners'],
    weapons: { rifle: 'no4', lmg: 'bren', smg: 'sten', pistol: 'webley' }, tankName: 'Cromwell', planeName: 'Spitfire',
  },
  {
    id: 'ussr', name: 'Soviet Union', adjective: 'Soviet', color: 0xa01818,
    capital: { lat: 55.75, lon: 37.6, name: 'Moscow' }, size: 15, industry: 1.1, manpower: 1.8,
    personality: 'aggressive', bloc: 'allies',
    description: 'Deep battle doctrine and the T-34. Bleed the invader, then roll west.',
    strengths: ['+80% manpower', 'T-34 armour', 'PPSh-41 squads'],
    weapons: { rifle: 'svt40', lmg: 'dp28', smg: 'ppsh', pistol: 'tt33' }, tankName: 'T-34', planeName: 'Il-2 Sturmovik',
  },
  {
    id: 'germany', name: 'Germany', adjective: 'German', color: 0x6a6a72,
    capital: { lat: 52.52, lon: 13.4, name: 'Berlin' }, size: 9, industry: 1.3, manpower: 1.0,
    personality: 'aggressive', bloc: 'axis',
    description: 'Blitzkrieg. Combined arms doctrine and the best tanks, against the whole world.',
    strengths: ['+30% industry', 'Panzer doctrine', 'MG 42'],
    weapons: { rifle: 'kar98k', lmg: 'mg42', smg: 'mp40', pistol: 'p38' }, tankName: 'Panzer IV', planeName: 'Bf 109',
  },
  {
    id: 'japan', name: 'Empire of Japan', adjective: 'Japanese', color: 0xe8c04a,
    capital: { lat: 35.68, lon: 139.7, name: 'Tokyo' }, size: 8, industry: 0.9, manpower: 1.1,
    personality: 'aggressive', bloc: 'axis',
    description: 'Island hopping in reverse. Fanatical infantry and a formidable carrier fleet.',
    strengths: ['Naval dominance', 'Fanatical defence', 'Type 99 LMG'],
    weapons: { rifle: 'arisaka', lmg: 'type99lmg', smg: 'type100', pistol: 'nambu' }, tankName: 'Type 97 Chi-Ha', planeName: 'A6M Zero',
  },
];

const ww2Techs: TechDef[] = [
  t('ww2_inf1', 'Infantry Doctrine', 'infantry', 1, 'Fire and movement drills. +10% infantry combat.', { infantry: 0.1 }),
  t('ww2_inf2', 'Submachine Guns', 'infantry', 2, 'Mass-issue submachine guns. Unlocks the SMG Assault kit.', { unlockKit: 'smg', infantry: 0.05 }),
  t('ww2_inf3', 'Field Medicine', 'infantry', 3, 'Penicillin and forward aid stations. +2 medkits, medics heal faster.', { medkits: 2, org: 0.15 }),
  t('ww2_inf4', 'Veteran Cadres', 'infantry', 4, 'Hardened NCO corps. +25% infantry combat, +10% defence.', { infantry: 0.25, defense: 0.1 }),
  t('ww2_arm1', 'Medium Tanks', 'armor', 1, 'Standardised medium armour. Unlocks the Tank Commander kit.', { tank: true, unlockKit: 'tank' }),
  t('ww2_arm2', 'Close Air Support', 'armor', 2, 'Forward air controllers. +2 air support calls.', { air: 2 }),
  t('ww2_arm3', 'Heavy Armour', 'armor', 3, 'Thicker plate and bigger guns. Tank armour +50%, +1 artillery.', { tankArmor: 0.5, artillery: 1 }),
  t('ww2_arm4', 'Air Superiority', 'armor', 4, 'Own the sky. +2 air support, +10% attack, faster movement.', { air: 2, infantry: 0.1, movement: 0.2 }),
  t('ww2_ind1', 'Rearmament', 'industry', 1, 'Convert factories to war production. +20% steel.', { steel: 0.2 }),
  t('ww2_ind2', 'Ammunition Plants', 'industry', 2, 'Dedicated munitions works. +30% munitions.', { munitions: 0.3 }),
  t('ww2_ind3', 'Mass Production', 'industry', 3, 'Interchangeable parts at scale. Jams -50%, +20% steel.', { jam: 0.5, steel: 0.2 }),
  t('ww2_ind4', 'Wartime Economy', 'industry', 4, 'Total war. +25% manpower, +25% research, +1 medkit.', { manpower: 0.25, research: 0.25, medkits: 1 }),
];

// ------------------------------------------------------------------ Modern
const modernNations: NationDef[] = [
  {
    id: 'usa', name: 'United States', adjective: 'American', color: 0x4fb3d9,
    capital: { lat: 38.9, lon: -77.0, name: 'Washington' }, size: 12, industry: 1.5, manpower: 1.0,
    personality: 'opportunist', bloc: 'west',
    description: 'Global reach, precision fires and the most expensive military on Earth.',
    strengths: ['+50% industry', 'Precision strikes', 'Night operations'],
    weapons: { rifle: 'm4a1', lmg: 'm249', dmr: 'm110', pistol: 'm17' }, tankName: 'M1A2 Abrams', planeName: 'F-35A',
  },
  {
    id: 'china', name: "People's Republic of China", adjective: 'Chinese', color: 0xd42c2c,
    capital: { lat: 39.9, lon: 116.4, name: 'Beijing' }, size: 12, industry: 1.6, manpower: 1.6,
    personality: 'cautious', bloc: 'east',
    description: 'The workshop of the world turned to war. Massive production and drone swarms.',
    strengths: ['+60% industry', '+60% manpower', 'Drone swarms'],
    weapons: { rifle: 'qbz191', lmg: 'qjy201', dmr: 'qbu', pistol: 'qsz92' }, tankName: 'Type 99A', planeName: 'J-20',
  },
  {
    id: 'russia', name: 'Russian Federation', adjective: 'Russian', color: 0x3a7d44,
    capital: { lat: 55.75, lon: 37.6, name: 'Moscow' }, size: 14, industry: 0.9, manpower: 1.2,
    personality: 'aggressive', bloc: 'east',
    description: 'Artillery, electronic warfare and depth. Strategic reserves but a strained economy.',
    strengths: ['+2 artillery strikes', 'Electronic warfare', 'Vast territory'],
    weapons: { rifle: 'ak12', lmg: 'pkm', dmr: 'svd', pistol: 'mp443' }, tankName: 'T-90M', planeName: 'Su-57',
  },
  {
    id: 'nato', name: 'NATO Coalition', adjective: 'Coalition', color: 0x2f4fb0,
    capital: { lat: 50.85, lon: 4.35, name: 'Brussels' }, size: 9, industry: 1.3, manpower: 0.9,
    personality: 'cautious', bloc: 'west',
    description: 'Europe united under one command. Interoperable, well-equipped, politically fragile.',
    strengths: ['+30% industry', 'Allied stability', 'HK416 squads'],
    weapons: { rifle: 'hk416', lmg: 'm249', dmr: 'm110', pistol: 'glock17' }, tankName: 'Leopard 2A7', planeName: 'Eurofighter Typhoon',
  },
  {
    id: 'regional', name: 'Regional Coalition', adjective: 'Coalition', color: 0xc78a2b,
    capital: { lat: 35.7, lon: 51.4, name: 'Tehran' }, size: 9, industry: 0.7, manpower: 1.4,
    personality: 'opportunist', bloc: 'nonaligned',
    description: 'A bloc of regional powers fighting on home ground. Cheap drones, deep manpower, weak industry.',
    strengths: ['+40% manpower', 'Loitering munitions', 'Home defence bonus'],
    weapons: { rifle: 'ak103', lmg: 'pkm', dmr: 'svd', pistol: 'glock17' }, tankName: 'T-72M', planeName: 'MiG-29',
  },
];

const modernTechs: TechDef[] = [
  t('mod_inf1', 'Modern Optics', 'infantry', 1, 'Red dots and magnified optics on every rifle. Spread -25%, +5% combat.', { spread: 0.25, infantry: 0.05 }),
  t('mod_inf2', 'Thermal Optics', 'infantry', 2, 'Thermal sights reveal enemies through smoke and dark. +10% combat.', { thermal: true, infantry: 0.1 }),
  t('mod_inf3', 'Marksman Program', 'infantry', 3, 'Designated marksmen in every squad. Unlocks the Marksman kit.', { unlockKit: 'marksman', infantry: 0.05 }),
  t('mod_inf4', 'Special Operations', 'infantry', 4, 'Tier-one training pipeline. +25% combat, +2 medkits.', { infantry: 0.25, medkits: 2 }),
  t('mod_arm1', 'Recon Drones', 'armor', 1, 'Quadcopter ISR for every platoon. Unlocks the recon drone call.', { drone: true }),
  t('mod_arm2', 'Precision Strikes', 'armor', 2, 'GPS-guided artillery. +2 artillery strikes.', { artillery: 2 }),
  t('mod_arm3', 'MBT Modernisation', 'armor', 3, 'Active protection and thermal gunnery. Unlocks the Tank Commander kit.', { tank: true, unlockKit: 'tank', tankArmor: 0.3 }),
  t('mod_arm4', 'Loitering Munitions', 'armor', 4, 'Kamikaze drone swarms. +2 air support calls, +10% attack.', { air: 2, infantry: 0.1 }),
  t('mod_ind1', 'Defense Industrial Base', 'industry', 1, 'Surge production capacity. +20% steel.', { steel: 0.2 }),
  t('mod_ind2', 'Munitions Surge', 'industry', 2, 'Shell and missile output tripled. +30% munitions.', { munitions: 0.3 }),
  t('mod_ind3', 'Advanced Manufacturing', 'industry', 3, 'Additive manufacturing. Jams -60%, +20% steel.', { jam: 0.6, steel: 0.2 }),
  t('mod_ind4', 'Electronic Warfare', 'industry', 4, 'Jam enemy comms and guidance. Enemy accuracy -15%, +25% research.', { enemyAccuracy: 0.15, research: 0.25 }),
];

export const ERAS: EraDef[] = [
  {
    id: 'ww1', name: 'World War I', years: '1914 – 1918', tagline: 'Attrition',
    description: 'Brutal trench warfare, creeping barrages, the first gas attacks and the first tanks. Every metre is paid for in blood.',
    startYear: 1914, startMonth: 8, nations: ww1Nations, techs: ww1Techs, weapons: WEAPONS, theme: 'trench',
    blocs: [['britain', 'france', 'russia'], ['germany', 'ottoman'], ['usa']],
    warsAtStart: [['germany', 'france'], ['germany', 'britain'], ['germany', 'russia'], ['ottoman', 'russia'], ['ottoman', 'britain']],
    moveDays: 4, kits: ['rifleman', 'medic', 'mg', 'smg', 'tank'], kitLocks: { mg: 'ww1_inf2', smg: 'ww1_inf4', tank: 'ww1_arm3' },
    focus: ['Trench networks', 'Chemical warfare', 'Creeping barrages', 'Landships'],
  },
  {
    id: 'ww2', name: 'World War II', years: '1939 – 1945', tagline: 'Manoeuvre',
    description: 'Blitzkrieg, massive armoured clashes, island hopping and the fight for the skies. Speed and industry decide everything.',
    startYear: 1941, startMonth: 12, nations: ww2Nations, techs: ww2Techs, weapons: WEAPONS, theme: 'ruins',
    blocs: [['usa', 'uk', 'ussr'], ['germany', 'japan']],
    warsAtStart: [['germany', 'uk'], ['germany', 'ussr'], ['japan', 'usa'], ['germany', 'usa']],
    moveDays: 3, kits: ['rifleman', 'smg', 'mg', 'medic', 'tank'], kitLocks: { smg: 'ww2_inf2', tank: 'ww2_arm1' },
    focus: ['Blitzkrieg', 'Armoured warfare', 'Air superiority', 'Urban ruins'],
  },
  {
    id: 'modern', name: 'Present Day', years: '2026 +', tagline: 'Precision',
    description: 'Drone swarms, precision missiles, electronic warfare and night operations. High-tech, high-mobility, high cost.',
    startYear: 2026, startMonth: 3, nations: modernNations, techs: modernTechs, weapons: WEAPONS, theme: 'urban',
    blocs: [['usa', 'nato'], ['china', 'russia']],
    warsAtStart: [['russia', 'nato'], ['china', 'usa'], ['regional', 'usa']],
    moveDays: 2, kits: ['rifleman', 'mg', 'medic', 'marksman', 'tank'], kitLocks: { marksman: 'mod_inf3', tank: 'mod_arm3' },
    focus: ['Drone warfare', 'Precision strikes', 'Night vision', 'Electronic warfare'],
  },
];

export function getEra(id: string): EraDef {
  const e = ERAS.find((x) => x.id === id);
  if (!e) throw new Error('Unknown era ' + id);
  return e;
}

export const KIT_INFO: Record<string, { name: string; desc: string }> = {
  rifleman: { name: 'Rifleman', desc: 'Standard service rifle, grenades, one medkit. The backbone of every army.' },
  mg: { name: 'Machine Gunner', desc: 'Light machine gun with a big magazine. Suppress, hold, and shred charges.' },
  smg: { name: 'Assault / Trench Raider', desc: 'Submachine gun for close quarters. Fast, deadly in trenches and ruins.' },
  medic: { name: 'Medic', desc: 'Carbine plus extra medkits. Heal nearby allies by standing beside them.' },
  marksman: { name: 'Marksman', desc: 'Scoped rifle for long engagements. Pick officers off before they reach you.' },
  tank: { name: 'Tank Commander', desc: 'Command an armoured vehicle. Cannon and coaxial MG. Slow, tough, decisive.' },
};

export const ROLE_INFO: Record<string, { name: string; desc: string }> = {
  commander: { name: 'Supreme Commander', desc: 'Start in the command map. Direct squads, drop artillery markers, call air support. Extra strikes.' },
  squadleader: { name: 'Squad Leader', desc: 'A squad of AI soldiers follows your lead. Q: Follow/Hold, E: Attack-move to aim point.' },
  soldier: { name: 'Boots on the Ground', desc: 'Spawn as a frontline soldier with your chosen kit. Fight for every metre.' },
};

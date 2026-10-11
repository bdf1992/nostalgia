// Original authored fixture for local-state replication tests, not game research.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const config = JSON.parse(await readFile(resolve('config.json'), 'utf8'));
const player = JSON.parse(await readFile(resolve('player.json'), 'utf8'));
const [scenario] = process.argv.slice(2);
let result;
if (scenario === 'startup') {
  result = { status: 'ready', version: config.version, player };
} else if (scenario === 'combat') {
  player.mana -= config.mana_cost;
  player.x = Math.min(config.movement_limit, player.x + 2);
  result = { player, target_hp: 100 - config.damage };
} else if (scenario === 'save-load') {
  player.gold += 2;
  await writeFile(resolve('player.json'), JSON.stringify(player));
  result = { saved: JSON.parse(await readFile(resolve('player.json'), 'utf8')) };
} else {
  throw new Error('Unknown original fixture scenario');
}
console.log(JSON.stringify(result));

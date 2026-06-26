/**
 * sync-data.js — 世界杯数据自动同步脚本
 * 从 worldcup26.ir API 拉取比赛结果和积分榜，自动更新 data.json
 * 
 * 用法: node sync-data.js
 */

const fs = require('fs');
const path = require('path');

// ============ 球队名称映射表 ============

// English → Chinese
const TEAM_NAME_MAP = {
  'Mexico': '墨西哥',
  'South Africa': '南非',
  'South Korea': '韩国',
  'Czech Republic': '捷克',
  'Canada': '加拿大',
  'Bosnia and Herzegovina': '波黑',
  'Qatar': '卡塔尔',
  'Switzerland': '瑞士',
  'Brazil': '巴西',
  'Morocco': '摩洛哥',
  'Haiti': '海地',
  'Scotland': '苏格兰',
  'United States': '美国',
  'Paraguay': '巴拉圭',
  'Australia': '澳大利亚',
  'Turkey': '土耳其',
  'Germany': '德国',
  'Curaçao': '库拉索',
  'Ivory Coast': '科特迪瓦',
  'Ecuador': '厄瓜多尔',
  'Netherlands': '荷兰',
  'Japan': '日本',
  'Sweden': '瑞典',
  'Tunisia': '突尼斯',
  'Spain': '西班牙',
  'Cape Verde': '佛得角',
  'Saudi Arabia': '沙特阿拉伯',
  'Uruguay': '乌拉圭',
  'Iran': '伊朗',
  'New Zealand': '新西兰',
  'France': '法国',
  'Senegal': '塞内加尔',
  'Iraq': '伊拉克',
  'Norway': '挪威',
  'Argentina': '阿根廷',
  'Algeria': '阿尔及利亚',
  'Austria': '奥地利',
  'Jordan': '约旦',
  'Portugal': '葡萄牙',
  'Democratic Republic of the Congo': '刚果(金)',
  'England': '英格兰',
  'Croatia': '克罗地亚',
  'Ghana': '加纳',
  'Panama': '巴拿马',
  'Uzbekistan': '乌兹别克斯坦',
  'Colombia': '哥伦比亚',
  'Belgium': '比利时',
  'Egypt': '埃及'
};

// API team_id → Chinese name
const TEAM_ID_MAP = {
  '1': '墨西哥', '2': '南非', '3': '韩国', '4': '捷克',
  '5': '加拿大', '6': '波黑', '7': '卡塔尔', '8': '瑞士',
  '9': '巴西', '10': '摩洛哥', '11': '海地', '12': '苏格兰',
  '13': '美国', '14': '巴拉圭', '15': '澳大利亚', '16': '土耳其',
  '17': '德国', '18': '库拉索', '19': '科特迪瓦', '20': '厄瓜多尔',
  '21': '荷兰', '22': '日本', '23': '瑞典', '24': '突尼斯',
  '25': '比利时', '26': '埃及', '27': '伊朗', '28': '新西兰',
  '29': '西班牙', '30': '佛得角', '31': '沙特阿拉伯', '32': '乌拉圭',
  '33': '法国', '34': '塞内加尔', '35': '伊拉克', '36': '挪威',
  '37': '阿根廷', '38': '阿尔及利亚', '39': '奥地利', '40': '约旦',
  '41': '葡萄牙', '42': '刚果(金)', '43': '乌兹别克斯坦', '44': '哥伦比亚',
  '45': '英格兰', '46': '克罗地亚', '47': '加纳', '48': '巴拿马'
};

// ============ 工具函数 ============

function toCN(name) {
  return TEAM_NAME_MAP[name] || name;
}

// 解析进球者字符串: "Player Name 27'" → { name: "Player Name" }
function parseScorer(scorerStr) {
  if (!scorerStr || scorerStr === 'null') return null;
  let cleaned = scorerStr.replace(/\(OG\)$/i, '').replace(/\(p\)$/i, '').trim();
  const match = cleaned.match(/^(.+?)\s+\d+/);
  if (match) return { name: match[1].trim() };
  return { name: cleaned.trim() };
}

// 解析 API 返回的 scorers 字段
// API 返回格式: "{\"name1 27'\",\"name2 45'\"}" — 用花括号的类JSON字符串
function parseScorersField(raw) {
  if (!raw || raw === 'null' || raw === '[]' || raw === '{}') return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    // 将花括号替换为方括号，使其成为合法 JSON 数组
    const fixed = raw.replace(/^\{/, '[').replace(/\}$/, ']');
    try {
      const parsed = JSON.parse(fixed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function beijingISO() {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().replace('Z', '+08:00').replace(/\.\d{3}/, '');
}

// ============ 主逻辑 ============

async function main() {
  console.log('[sync] Fetching worldcup26.ir API...');

  // 并行请求
  const [gamesRes, groupsRes] = await Promise.all([
    fetch('https://worldcup26.ir/get/games'),
    fetch('https://worldcup26.ir/get/groups')
  ]);

  if (!gamesRes.ok) throw new Error(`Games API returned ${gamesRes.status}`);
  if (!groupsRes.ok) throw new Error(`Groups API returned ${groupsRes.status}`);

  const gamesData = await gamesRes.json();
  const groupsData = await groupsRes.json();

  // ---- 提取已完成比赛 ----
  // API 返回 { games: [...] }，每个 game 有 flat 字段: home_team_name_en, away_team_name_en
  const allGames = gamesData.games || (Array.isArray(gamesData) ? gamesData : []);
  const finishedMatches = allGames.filter(g => g.finished === 'TRUE' || g.finished === true);

  console.log(`[sync] Found ${finishedMatches.length} finished matches (total ${allGames.length} games)`);

  // ---- 构建 completedResults & matchScorers ----
  const completedResults = {};
  const matchScorers = {};

  for (const m of finishedMatches) {
    // API 使用扁平字段: home_team_name_en / away_team_name_en
    const homeCN = toCN(m.home_team_name_en || m.home_team?.name_en);
    const awayCN = toCN(m.away_team_name_en || m.away_team?.name_en);

    if (!homeCN || !awayCN) {
      console.warn(`[sync] Unknown team: ${m.home_team_name_en || '?'} vs ${m.away_team_name_en || '?'}, skipping (id=${m.id})`);
      continue;
    }

    const key = `${homeCN}-${awayCN}`;
    completedResults[key] = `${m.home_score}:${m.away_score}`;

    // 解析进球者（scorers 字段是 JSON 字符串）
    const homeScorers = parseScorersField(m.home_scorers);
    const awayScorers = parseScorersField(m.away_scorers);
    const rawList = [];

    for (const s of homeScorers) {
      const p = parseScorer(s);
      if (p) rawList.push({ name: p.name, team: homeCN });
    }
    for (const s of awayScorers) {
      const p = parseScorer(s);
      if (p) rawList.push({ name: p.name, team: awayCN });
    }

    // 合并同一球员的多球
    const merged = {};
    for (const s of rawList) {
      const k = `${s.name}|${s.team}`;
      if (merged[k]) { merged[k].goals += 1; }
      else { merged[k] = { name: s.name, team: s.team, goals: 1 }; }
    }
    matchScorers[key] = Object.values(merged);
  }

  // ---- 构建 groupStandings ----
  const groupStandings = {};
  const groupList = groupsData.groups || groupsData;

  for (const g of groupList) {
    const arr = [];
    for (const t of g.teams) {
      arr.push({
        team: TEAM_ID_MAP[t.team_id] || `Team${t.team_id}`,
        played: parseInt(t.mp) || 0,
        won: parseInt(t.w) || 0,
        drawn: parseInt(t.d) || 0,
        lost: parseInt(t.l) || 0,
        gf: parseInt(t.gf) || 0,
        ga: parseInt(t.ga) || 0,
        gd: parseInt(t.gd) || 0,
        pts: parseInt(t.pts) || 0
      });
    }
    // 按积分→净胜球→进球排序
    arr.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    groupStandings[g.name] = arr;
  }

  console.log(`[sync] Built standings for ${Object.keys(groupStandings).length} groups`);

  // ---- 读取现有 data.json 保留软数据 ----
  const dataPath = path.join(__dirname, 'data.json');
  let existing = {};
  if (fs.existsSync(dataPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (e) {
      console.warn('[sync] Failed to parse existing data.json, starting fresh');
    }
  }

  // ---- 合并输出 ----
  const output = {
    lastUpdated: beijingISO(),
    completedResults,
    halftimeResults: existing.halftimeResults || {},
    matchScorers,
    matchAssists: existing.matchAssists || {},
    groupStandings,
    upsetAnalysis: existing.upsetAnalysis || [],
    visitorComments: existing.visitorComments || [],
    upsetRumors: existing.upsetRumors || [],
    teamRumors: existing.teamRumors || []
  };

  fs.writeFileSync(dataPath, JSON.stringify(output, null, 2), 'utf8');

  const matchCount = Object.keys(completedResults).length;
  console.log(`[sync] DONE — ${matchCount} matches, ${Object.keys(groupStandings).length} groups written to data.json`);
  console.log(`[sync] Last updated: ${output.lastUpdated}`);
}

main().catch(err => {
  console.error(`[sync] FATAL: ${err.message}`);
  process.exit(1);
});

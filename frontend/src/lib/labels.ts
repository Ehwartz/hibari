// Chinese labels for yaku (names from the `mahjong` Python library), draws and hand limits.

export const YAKU_NAME: Record<string, string> = {
  Riichi: '立直',
  'Double Riichi': '两立直',
  Ippatsu: '一发',
  'Menzen Tsumo': '门前清自摸和',
  Pinfu: '平和',
  Tanyao: '断幺九',
  Iipeiko: '一杯口',
  Ryanpeikou: '二杯口',
  'Yakuhai (haku)': '役牌 白',
  'Yakuhai (hatsu)': '役牌 发',
  'Yakuhai (chun)': '役牌 中',
  'Yakuhai (round wind east)': '场风 东',
  'Yakuhai (round wind south)': '场风 南',
  'Yakuhai (round wind west)': '场风 西',
  'Yakuhai (round wind north)': '场风 北',
  'Yakuhai (seat wind east)': '自风 东',
  'Yakuhai (seat wind south)': '自风 南',
  'Yakuhai (seat wind west)': '自风 西',
  'Yakuhai (seat wind north)': '自风 北',
  'Haitei Raoyue': '海底摸月',
  'Houtei Raoyui': '河底捞鱼',
  'Rinshan Kaihou': '岭上开花',
  Chankan: '抢杠',
  Chantai: '混全带幺九',
  Junchan: '纯全带幺九',
  Ittsu: '一气通贯',
  'Sanshoku Doujun': '三色同顺',
  'Sanshoku Doukou': '三色同刻',
  Toitoi: '对对和',
  'San Ankou': '三暗刻',
  'San Kantsu': '三杠子',
  Chiitoitsu: '七对子',
  Honroutou: '混老头',
  'Shou Sangen': '小三元',
  Honitsu: '混一色',
  Chinitsu: '清一色',
  Dora: '宝牌',
  'Aka Dora': '赤宝牌',
  'Ura Dora': '里宝牌',
  'Nagashi Mangan': '流局满贯',
  'Kokushi Musou': '国士无双',
  'Kokushi Musou Juusanmen Matchi': '国士无双十三面',
  'Suu Ankou': '四暗刻',
  'Suu Ankou Tanki': '四暗刻单骑',
  Daisangen: '大三元',
  Shousuushii: '小四喜',
  'Dai Suushii': '大四喜',
  'Tsuu Iisou': '字一色',
  Ryuuiisou: '绿一色',
  Chinroutou: '清老头',
  'Chuuren Poutou': '九莲宝灯',
  'Daburu Chuuren Poutou': '纯正九莲宝灯',
  'Suu Kantsu': '四杠子',
  Tenhou: '天和',
  Chiihou: '地和',
}

export const yakuName = (name: string) => YAKU_NAME[name] ?? name

export const RYUKYOKU_NAME: Record<string, string> = {
  exhaustive: '荒牌流局',
  nagashi_mangan: '流局满贯',
  kyuushu_kyuuhai: '九种九牌',
  suufon_renda: '四风连打',
  suucha_riichi: '四家立直',
  suukaikan: '四杠散了',
  sanchahou: '三家和了',
}

export function limitName(han: number, fu: number, yakuman: boolean): string {
  if (yakuman) return han >= 26 ? `${Math.floor(han / 13)}倍役满` : '役满'
  if (han >= 13) return '累计役满'
  if (han >= 11) return '三倍满'
  if (han >= 8) return '倍满'
  if (han >= 6) return '跳满'
  if (han >= 5 || (han === 4 && fu >= 40) || (han === 3 && fu >= 70)) return '满贯'
  return ''
}

export const YAKUMAN = new Set([
  'Kokushi Musou', 'Kokushi Musou Juusanmen Matchi', 'Suu Ankou', 'Suu Ankou Tanki', 'Daisangen',
  'Shousuushii', 'Dai Suushii', 'Tsuu Iisou', 'Ryuuiisou', 'Chinroutou', 'Chuuren Poutou',
  'Daburu Chuuren Poutou', 'Suu Kantsu', 'Tenhou', 'Chiihou',
])

export const HINT_VERB: Record<string, string> = {
  dahai: '打', reach: '立直', chi: '吃', pon: '碰', kan: '杠', hora: '和', ryukyoku: '流局', none: '跳过',
}

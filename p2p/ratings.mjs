export const INITIAL_RATING = 1200;
export function eloDelta(red, black, result) {
  const actual = result === 'draw' ? 0.5 : result === 'red' ? 1 : 0;
  return Math.round(32 * (actual - 1 / (1 + 10 ** ((black - red) / 400))));
}
export function nearestOpponent(entries, name, minutes, rating, now, available) {
  return entries.filter(([player, entry]) => player !== name && entry.minutes === minutes && available(player))
    .map(([player, entry]) => ({player, entry, gap:Math.abs(rating(name)-rating(player))}))
    .filter(({gap,entry}) => now-entry.joined >= 180000 || gap <= 150 + 50*Math.floor(Math.max(0,now-entry.joined)/15000))
    .sort((a,b) => a.gap-b.gap || a.entry.joined-b.entry.joined)[0]?.player;
}
export function createRatings(db) {
  db.exec('CREATE TABLE IF NOT EXISTS ratings(name TEXT PRIMARY KEY, rating INTEGER NOT NULL, games INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rating_games(game TEXT PRIMARY KEY, red_before INTEGER NOT NULL, black_before INTEGER NOT NULL, delta INTEGER NOT NULL)');
  const get = name => db.prepare('SELECT rating,games FROM ratings WHERE name=?').get(name) ?? {rating:INITIAL_RATING,games:0};
  function sync() {
    const rows=db.prepare("SELECT * FROM game_history WHERE ended IS NOT NULL AND red_moved=1 AND black_moved=1 AND result IN ('red','black','draw') AND id NOT IN (SELECT game FROM rating_games) ORDER BY ended,started,id").all();
    if(!rows.length)return;
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const row of rows) {
        const red=get(row.red),black=get(row.black),delta=eloDelta(red.rating,black.rating,row.result);
        db.prepare('INSERT INTO rating_games VALUES(?,?,?,?)').run(row.id,red.rating,black.rating,delta);
        for(const [name,previous,change] of [[row.red,red,delta],[row.black,black,-delta]]) db.prepare('INSERT INTO ratings VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET rating=excluded.rating,games=excluded.games').run(name,previous.rating+change,previous.games+1);
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  sync();
  return {get,sync};
}

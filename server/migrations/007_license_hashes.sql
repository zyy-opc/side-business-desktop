-- 007: license hash cache (GitHub 激活码哈希表本地缓存)
CREATE TABLE IF NOT EXISTS license_hash_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

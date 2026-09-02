"""
法规全文搜索基准测试
验收标准：5000+ 部法规时搜索响应 < 300ms
运行: python scripts/bench_search.py

复刻 database.ts 的表结构（laws/articles/articles_fts + 触发器）
与 searchArticles() 的实际 SQL（LIKE 主检索 + 多关键词 AND + FTS 补充）。
SQLite 引擎与 better-sqlite3 相同，查询耗时特征一致。
"""
import os
import sqlite3
import sys
import tempfile
import time

LAW_COUNT = 5000
ARTICLES_PER_LAW = 30

SCHEMA = """
CREATE TABLE laws (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT '规范性文件',
  issuing_body TEXT,
  document_number TEXT,
  publish_date TEXT,
  effective_date TEXT,
  status TEXT NOT NULL DEFAULT 'effective',
  full_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_laws_type ON laws(document_type);
CREATE INDEX idx_laws_status ON laws(status);
CREATE INDEX idx_laws_title ON laws(title);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  law_id TEXT NOT NULL REFERENCES laws(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES articles(id),
  level INTEGER NOT NULL DEFAULT 4,
  order_num INTEGER NOT NULL,
  article_num TEXT,
  title TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_articles_law ON articles(law_id);
CREATE INDEX idx_articles_parent ON articles(parent_id);
CREATE INDEX idx_articles_level ON articles(law_id, level);

CREATE VIRTUAL TABLE articles_fts USING fts5(
  article_num, title, content, content=articles, content_rowid=rowid
);
CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, article_num, title, content)
  VALUES (new.rowid, new.article_num, new.title, new.content);
END;
CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, article_num, title, content)
  VALUES ('delete', old.rowid, old.article_num, old.title, old.content);
END;
CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, article_num, title, content)
  VALUES ('delete', old.rowid, old.article_num, old.title, old.content);
  INSERT INTO articles_fts(rowid, article_num, title, content)
  VALUES (new.rowid, new.article_num, new.title, new.content);
END;
"""

SENTENCES = [
    '当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。',
    '合同是民事主体之间设立、变更、终止民事法律关系的协议。自然人、法人和非法人组织均可依法订立合同。',
    '当事人订立合同，可以采取要约、承诺方式或者其他方式。要约是希望与他人订立合同的意思表示。',
    '违约金过高的，当事人可以请求人民法院或者仲裁机构予以适当减少；违约金过低的，可以请求增加。',
    '因当事人一方的违约行为，损害对方人身权益、财产权益的，受损害方有权选择请求其承担违约责任或者侵权责任。',
    '合同的权利义务关系，应当遵循诚实信用原则，根据合同的性质、目的和交易习惯履行通知、协助、保密等附随义务。',
    '依法成立的合同，对当事人具有法律约束力。当事人应当按照约定履行自己的义务，不得擅自变更或者解除合同。',
    '借款人应当按照约定的期限支付利息和返还借款；逾期返还的，应当按照约定或者国家有关规定支付逾期利息。',
]

SINGLE_SQL = """
SELECT a.id, a.law_id, a.article_num, a.content,
       l.title AS law_title, substr(a.content, 1, 120) AS snippet
FROM articles a JOIN laws l ON a.law_id = l.id
WHERE (a.content LIKE ? OR a.title LIKE ? OR a.article_num LIKE ?)
ORDER BY l.title, a.order_num
LIMIT ?
"""

MULTI_SQL = """
SELECT a.id, a.law_id, a.article_num, a.content,
       l.title AS law_title, substr(a.content, 1, 120) AS snippet
FROM articles a JOIN laws l ON a.law_id = l.id
WHERE {like_parts}
ORDER BY l.title, a.order_num
LIMIT ?
"""

FTS_SQL = """
SELECT a.id, a.law_id, a.article_num, a.content,
       l.title AS law_title,
       snippet(articles_fts, 2, '<mark>', '</mark>', '...', 40) AS snippet
FROM articles_fts f
JOIN articles a ON f.rowid = a.rowid
JOIN laws l ON a.law_id = l.id
WHERE articles_fts MATCH ?
ORDER BY rank
LIMIT ?
"""


def main():
    fd, db_path = tempfile.mkstemp(suffix=".db", prefix="lawpilot-bench-")
    os.close(fd)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)

    t0 = time.time()
    cur = conn.cursor()
    for i in range(LAW_COUNT):
        law_id = f"law-{i}"
        cur.execute("INSERT INTO laws (id, title, full_text) VALUES (?, ?, '')",
                    (law_id, f"模拟法规第{i}号（关于合同与民事责任的规定）"))
        for j in range(ARTICLES_PER_LAW):
            s1 = SENTENCES[(i + j) % len(SENTENCES)]
            s2 = SENTENCES[(i * 3 + j * 7) % len(SENTENCES)]
            cur.execute(
                "INSERT INTO articles (id, law_id, level, order_num, article_num, title, content) "
                "VALUES (?, ?, 4, ?, ?, ?, ?)",
                (f"art-{i}-{j}", law_id, j, f"第{j + 1}条", f"第{j + 1}条", s1 + s2))
    conn.commit()
    art_count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    print(f"数据装载: {LAW_COUNT} 部法规 / {art_count} 条款，用时 {(time.time() - t0) * 1000:.0f}ms")

    def bench(sql, params, label, rounds=30, limit=50):
        best = float("inf")
        rows = None
        for _ in range(rounds):
            s = time.perf_counter()
            rows = conn.execute(sql, (*params, limit)).fetchall()
            e = (time.perf_counter() - s) * 1000
            if e < best:
                best = e
        print(f"{label:24s}: {best:8.1f}ms  (命中 {len(rows or [])} 条, 上限 {limit})")
        return best

    p = "%合同%"
    single = bench(SINGLE_SQL, (p, p, p), '单关键词 LIKE "合同"')
    p2 = "%违约金%"
    single_rare = bench(SINGLE_SQL, (p2, p2, p2), '单关键词 LIKE "违约金"')
    multi = bench(MULTI_SQL.format(
        like_parts=" AND ".join(["(a.content LIKE ? OR a.title LIKE ? OR a.article_num LIKE ?)",
                                 "(a.content LIKE ? OR a.title LIKE ? OR a.article_num LIKE ?)"])),
        ("%合同%", "%合同%", "%合同%", "%订立%", "%订立%", "%订立%"),
        '多关键词 AND "合同 订立"')
    fts = bench(FTS_SQL, ('"合同"',), 'FTS5 MATCH "合同"')

    ok = all(x < 300 for x in (single, single_rare, multi, fts))
    print()
    print(f"{'✅ 达标' if ok else '❌ 未达标'}：5000 部法规 / {art_count} 条款，"
          f"{'所有搜索路径 < 300ms' if ok else '存在 > 300ms 的搜索路径'}")

    conn.close()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(db_path + suffix)
        except FileNotFoundError:
            pass
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

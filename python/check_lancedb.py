"""Quick check LanceDB data for encoding issues"""
import lancedb
import os
import sys

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

VECTOR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'vectors')
print(f"DB path: {VECTOR_DIR}")

if not os.path.exists(VECTOR_DIR):
    # Try alternative paths
    alt = os.path.join(os.getenv('APPDATA', ''), 'LawPilot', 'vector_db')
    if os.path.exists(alt):
        VECTOR_DIR = alt
    else:
        print("Vector DB not found")
        exit(1)

db = lancedb.connect(VECTOR_DIR)
tables = db.table_names()
print(f"Tables: {tables}")

if 'knowledge_base' in tables:
    t = db.open_table('knowledge_base')
    df = t.to_pandas()
    print(f"Total rows: {len(df)}")
    for _, r in df.iterrows():
        title = str(r.get('title', ''))
        if '人工智能' in title:
            text = str(r.get('text', ''))
            print(f"ID: {r['id']}")
            print(f"Title: {title}")
            print(f"Text length: {len(text)}")
            print(f"Full text:")
            print(text)
            print("===")
else:
    print("No knowledge_base table")

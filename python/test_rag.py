"""Test new RAG engine"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from app.services.rag_engine import rewrite_query, hybrid_search, build_context, build_rag_messages

print("=" * 60)
print("Test 1: Query Rewriting")
print("=" * 60)
queries = rewrite_query("第三条原文是什么")
print(f"Input: '第三条原文是什么'")
print(f"Rewritten: {queries}")

queries = rewrite_query("《人工智能管理法》第八条规定了什么")
print(f"\nInput: '《人工智能管理法》第八条规定了什么'")
print(f"Rewritten: {queries}")

queries = rewrite_query("著作权侵权赔偿")
print(f"\nInput: '著作权侵权赔偿'")
print(f"Rewritten: {queries}")

print("\n" + "=" * 60)
print("Test 2: Hybrid Search")
print("=" * 60)

results = hybrid_search("第三条原文是什么", top_k=5)
print(f"\nQuery: '第三条原文是什么'")
print(f"Results: {len(results)}")
for i, r in enumerate(results):
    print(f"  [{i+1}] score={r['score']:.3f} dist={r['distance']:.3f} title={r['title'][:30]}")
    print(f"      text[:80]: {r['text'][:80]}...")

print("\n" + "=" * 60)
print("Test 3: Context Building")
print("=" * 60)

context = build_context(results)
print(f"Context length: {len(context)} chars")
print(f"Context preview:\n{context[:500]}...")

print("\n" + "=" * 60)
print("Test 4: RAG Messages")
print("=" * 60)

messages = build_rag_messages("第三条原文是什么", results)
print(f"System prompt length: {len(messages[0]['content'])} chars")
print(f"User message: {messages[1]['content']}")
print(f"\nSystem prompt preview:\n{messages[0]['content'][:800]}...")

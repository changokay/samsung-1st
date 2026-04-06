---
name: coupang-product-search
description: coupang-mcp 서버를 통해 쿠팡 상품 검색, 로켓배송 필터, 가격대 검색, 상품 비교, 베스트 상품, 골드박스 특가를 조회한다.
license: MIT
metadata:
  category: retail
  locale: ko-KR
  phase: v2
---

# Coupang Product Search

## What this skill does

[coupang-mcp](https://github.com/uju777/coupang-mcp) 서버를 경유하여 쿠팡 상품을 검색하고 실시간 가격을 확인한다.

- 키워드 상품 검색 (로켓배송/일반배송 구분)
- 로켓배송 전용 필터 검색
- 가격대 범위 검색
- 상품 비교표 생성
- 카테고리별 베스트 상품
- 골드박스 당일 특가
- 인기 검색어/계절 상품 추천

## How it works

```
Claude Code
  → MCP Streamable HTTP (JSON-RPC)
    → HF Space (coupang-mcp 서버)
      → Netlify 프록시 (도쿄)
        → 다나와 가격 조회 (1차) / 쿠팡 API 폴백
```

- API 키 불필요
- 다나와에서 정확한 판매가 우선 조회, 실패 시 쿠팡 API 가격 자동 폴백
- 해외 IP 차단 우회를 위해 도쿄 리전 프록시 경유

## MCP endpoint

```
https://yuju777-coupang-mcp.hf.space/mcp
```

## When to use

- "쿠팡에서 생수 가격 좀 찾아줘"
- "로켓배송 에어팟 찾아줘"
- "20만원 이하 키보드 추천해줘"
- "아이패드 vs 갤럭시탭 비교"
- "오늘 쿠팡 특가 뭐 있어?"
- "전자제품 베스트 보여줘"

## When not to use

- 로그인, 장바구니, 결제 자동화가 필요한 경우
- 쿠팡 계정/session 접근이 필요한 경우

## Workflow

### 1. Clarify the need

검색어가 너무 넓으면 먼저 의도를 좁힌다.

- 권장 질문: `어떤 용도/예산/브랜드/용량을 우선할까요?`

### 2. Initialize MCP session

coupang-mcp는 MCP Streamable HTTP 프로토콜을 사용한다. 세션을 초기화한 뒤 도구를 호출한다.

```bash
# Step 1: Initialize and get session ID
SESSION_ID=$(curl -s -X POST "https://yuju777-coupang-mcp.hf.space/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"k-skill","version":"1.0"}}}' \
  -D /dev/stderr 2>&1 1>/dev/null | grep -i 'mcp-session-id' | awk '{print $2}' | tr -d '\r')
```

### 3. Call tools

세션 ID를 얻은 뒤 `tools/call` 로 원하는 도구를 호출한다.

```bash
curl -s -X POST "https://yuju777-coupang-mcp.hf.space/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_coupang_products","arguments":{"keyword":"32인치 4K 모니터"}}}' \
  2>&1 | grep "^data:" | sed 's/^data: //'
```

## Available tools

| 도구명 | 기능 | 파라미터 예시 |
|--------|------|-------------|
| `search_coupang_products` | 일반 상품 검색 | `{"keyword":"생수"}` |
| `search_coupang_rocket` | 로켓배송만 필터링 | `{"keyword":"에어팟"}` |
| `search_coupang_budget` | 가격대 범위 검색 | `{"keyword":"키보드","min_price":0,"max_price":100000}` |
| `compare_coupang_products` | 상품 비교표 생성 | `{"keyword":"아이패드 vs 갤럭시탭"}` |
| `get_coupang_recommendations` | 인기 검색어 제안 | `{}` |
| `get_coupang_seasonal` | 계절/상황별 추천 | `{"keyword":"설날 선물"}` |
| `get_coupang_best_products` | 카테고리별 베스트 | `{"keyword":"전자제품"}` |
| `get_coupang_goldbox` | 당일 특가 정보 | `{}` |

## Response format

결과는 로켓배송(rocket)과 일반배송(normal)으로 구분되어 반환된다.

```
## rocket (6)

1) LG전자 4K UHD 모니터
   옵션: 80cm / 32UR500K
   가격: 397,750원 (39만원대)
   보러가기: https://link.coupang.com/a/...

## normal (4)

1) 삼성전자 QHD 오디세이 G5 게이밍 모니터
   가격: 283,000원 (28만원대)
   보러가기: https://link.coupang.com/a/...
```

## Response policy

- 후보가 여러 개면 상위 3~5개만 짧게 비교한다.
- 로켓배송/일반배송 구분을 명시한다.
- 가격은 참고용임을 안내한다 (다나와 실패 시 쿠팡 API 추정가).
- MCP 서버가 응답하지 않으면 서버 상태를 알리고 나중에 재시도를 권한다.

## Done when

- 검색 결과가 로켓배송/일반배송으로 구분되어 정리되었다.
- 사용자 니즈에 맞는 추천 TOP 3이 제시되었다.
- 가격/배송 정보가 포함되었다.

-- ADOFAI ANALYZER 계정 DB (Cloudflare D1)
-- D1 콘솔에 이 내용을 붙여 넣고 실행하세요. 여러 번 실행해도 안전합니다.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,            -- 입력한 그대로의 ID
  id_lower    TEXT NOT NULL UNIQUE,        -- 대소문자 무시 중복 확인용
  nick        TEXT NOT NULL,
  nick_lower  TEXT NOT NULL UNIQUE,
  pw_hash     TEXT NOT NULL,               -- PBKDF2-SHA256 결과
  pw_salt     TEXT NOT NULL,
  iters       INTEGER NOT NULL,
  fail_count  INTEGER NOT NULL DEFAULT 0,  -- 연속 로그인 실패 횟수
  locked_until INTEGER NOT NULL DEFAULT 0, -- 이 시각(초)까지 로그인 잠금
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,            -- 쿠키 토큰의 SHA-256 (토큰 원본은 저장 안 함)
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS saved (
  user_id     TEXT NOT NULL,
  level_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, level_id)
);

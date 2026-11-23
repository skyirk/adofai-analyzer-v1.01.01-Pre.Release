# ADOFAI ANALYZER

얼불춤(A Dance of Fire and Ice) 포럼 레벨을 **난이도 · 키 개수 · 패턴** 조건으로 정밀하게 필터링해서 추천 목록으로 보여주는 웹 서비스입니다.
순수 HTML / CSS / JavaScript로 만들어져 빌드 과정 없이 GitHub Pages에 바로 올릴 수 있습니다.

## 주요 기능
- 소개(인트로) 화면: 불·얼음 두 행성이 타일 길을 도는 애니메이션. 버튼·Enter·Esc 로 시작하고, 로고를 누르면 다시 볼 수 있음 (한 번 보면 같은 탭에서는 건너뜀, 모션 줄이기 설정 시 정지 화면)
- 난이도 단위 선택: **PGU** (P1 ~ U20) / **레거시** (1 ~ 21.3+)
- 이중 슬라이더로 난이도 범위 지정
- 선호 키 개수 선택 (1 ~ 16키, 16+; 선택한 키 개수 이하의 맵만 표시) + 일반 / 제한 맵 구분
- 패턴 선택: 질주, 복합, 체력, 개박, 동타, 마법진, 기믹, 판정제한 (하나라도 포함 / 모두 포함)
- 포럼 기준 맵만 보기
- 레벨 목록 (30개씩 "더 보기") + 상세 설명 팝업
- 카드의 **포럼** 버튼으로 TUF 맵 페이지 바로 열기
- 회원가입 / 로그인 (ID·비밀번호 규칙 검사, 닉네임 실시간 중복 확인)
- 맵 리스트 저장 (로그인 필요)
- tuforums.com / 레벨 포럼 바로가기

## 파일 구조
```
adofai-analyzer/
├─ index.html   화면 구조
├─ style.css    자주색·어두운 보라색 테마
├─ app.js       필터 / 목록 / 로그인 / 저장 로직
├─ levels.json  레벨 데이터 (TUF 맵 요약 + 링크)
├─ tools/       맵 자동 추가 도구 (add_levels.py)
├─ .github/workflows/add-levels.yml   GitHub 에서 자동 실행
└─ README.md
```

## GitHub Pages 배포
1. 이 폴더의 파일들을 저장소 루트에 올립니다.
2. 저장소 **Settings → Pages → Branch: main / (root)** 선택 후 저장.
3. 잠시 후 `https://<계정>.github.io/<저장소>/` 에서 확인할 수 있습니다.

## 레벨 데이터 추가
`levels.json` 배열에 항목을 추가하세요.
이 앱은 세부 내용을 복사해 두지 않고, **필터링에 필요한 요약 정보 + 포럼 링크**만 가집니다.

| 필드 | 설명 |
|---|---|
| `id` | 고유 문자열 |
| `name`, `creator` | 레벨 이름, 제작자 |
| `pgu` | "P1"~"P20", "G1"~"G20", "U1"~"U20" (없으면 null) |
| `legacy` | "1"~"21.3+" (없으면 null) |
| `keys` | 쓰는 키 개수. 16키를 넘으면 17 이상으로 적고 화면에는 `16+키`로 나옵니다 |
| `keyLimit` | 키 수를 제한한 맵이면 `true` (예: 10키 제한) |
| `bpm` | BPM |
| `patterns` | 질주, 복합, 체력, 개박, 동타, 마법진, 기믹, 판정제한 중 선택 |
| `reference`, `refFor` | 포럼 기준 맵 여부, 어떤 패턴의 기준인지 |
| `desc` | 짧은 설명 |
| `tufId` | TUF 맵 번호. `https://tuforums.com/levels/<tufId>` 링크가 자동으로 만들어집니다 |
| `forumUrl` | 다른 주소를 직접 쓰고 싶을 때 (tufId 보다 우선) |
| `videoUrl` | 영상 링크 (선택) |

모르는 값(`pgu`, `legacy`, `keys`, `bpm`)은 `null`로 두면 됩니다. 난이도를 모르는 레벨은 목록 맨 뒤에 놓이고, 난이도 범위를 건드리지 않았을 때만 보입니다.

예시:
```json
{ "id": "u13-sprint-1", "name": "레벨 이름", "creator": "제작자",
  "pgu": "U13", "legacy": null, "keys": 8, "bpm": 250,
  "patterns": ["질주"], "reference": false, "desc": "", "tufId": 2467 }
```

> `levels.json` 은 `fetch` 로 불러오기 때문에 **GitHub Pages 에서는 그대로 동작**하지만, `index.html` 을 더블클릭(file://)으로 열면 막힙니다.
> 로컬에서 확인할 때는 폴더에서 `python -m http.server` 를 실행하고 `http://localhost:8000` 으로 접속하세요.

## 맵 자동 추가 (tools/add_levels.py)
맵을 하나씩 손으로 적는 대신, **번호·난이도·키·패턴만 적으면 이름·제작자·채보자는 포럼에서 자동으로 읽어서** `levels.json`에 넣어 줍니다.
Python 3 만 있으면 되고 따로 설치할 것은 없습니다.

1. `tools/new_levels.txt` 를 만들고 한 줄에 맵 하나씩 적습니다. (`tools/new_levels.example.txt` 참고)
   ```
   7684 U12 16 체력,질주,복합
   6206 U13 10제한 체력,질주,기믹
   https://tuforums.com/levels/87 U11 16 질주,복합
   ```
   형식은 `맵번호(또는 링크) 난이도 키개수 패턴,패턴` 입니다. 키 개수 뒤에 `제한`을 붙이면 키 제한 맵(`keyLimit`)으로 기록되고, 16키를 넘으면 `16+`라고 적고, 패턴은 띄어쓰기 없이 쉼표로 잇습니다.
2. 저장소 폴더에서 실행합니다.
   ```
   python tools/add_levels.py tools/new_levels.txt          # 저장
   python tools/add_levels.py tools/new_levels.txt --dry    # 저장 없이 결과만 확인
   ```
3. 레거시 난이도는 TUF 난이도표(U1~U16)로 자동 계산됩니다. 실행 전에 `levels.json.bak` 으로 백업하고, 이미 있는 맵 번호는 덮어씁니다.

포럼 페이지를 못 읽은 맵은 `TUF #번호 (이름 미확인)` 으로 들어가니 실행 결과에 `주의`가 뜬 줄만 직접 고치면 됩니다.
이름·제작자·채보자는 TUF API(`api.tuforums.com/v2/database/levels/번호`)로 번호 하나씩 조회하고, 안 되면 포럼 페이지에서 읽습니다. 실행 로그의 "주의" 줄에 API 응답 항목 이름이 나오면 그대로 알려 주세요(항목 이름 매핑을 맞춥니다).
포럼에 부담을 주지 않도록 맵 사이에 1초씩 쉽니다. 한 번에 수십 개 정도까지만 쓰고, 대량으로 필요하면 TUF 운영진에게 API 사용을 문의하세요.

### 컴퓨터 없이 GitHub 에서 자동으로 (태블릿, 폰 가능)
`.github/workflows/add-levels.yml` 이 있으면 파이썬을 설치하지 않아도 됩니다. GitHub 이 대신 실행해 줍니다.
1. 저장소에서 `tools/new_levels.txt` 를 만들거나 연필(편집) 버튼으로 열어 맵 줄을 적고 **Commit changes** 를 누릅니다.
2. 1~2분 뒤 **Actions** 탭에 초록 체크가 뜨면 `levels.json` 이 갱신되어 있습니다. 처리한 입력은 자동으로 비워지고, 결과는 `tools/last_run.log` 에 남습니다.
3. 추가된 맵이 없으면 커밋 없이 끝납니다. 이유는 Actions 탭의 실행 로그에서 볼 수 있습니다.
- 워크플로 파일은 폴더째 올리기 어려우니, 웹에서 **Add file → Create new file** 로 파일 이름에 `.github/workflows/add-levels.yml` 을 입력하고 내용을 붙여넣으세요.
- 권한 오류(403)가 나면 **Settings → Actions → General → Workflow permissions** 에서 *Read and write permissions* 를 선택합니다.

## 계정 DB 연결 (Cloudflare D1)
로그인·회원가입·저장한 맵은 **Cloudflare Pages + D1** 에 연결하면 서버 DB에 저장되어, 어느 기기에서든 같은 계정으로 쓸 수 있습니다.
연결하지 않으면(GitHub Pages 등) 예전처럼 이 브라우저에만 저장하는 연습용 모드로 자동 전환됩니다.

필요한 파일: 저장소 맨 위에 `functions/api/[[path]].js` (서버 코드), `schema.sql` (표 만드는 SQL).

1. Cloudflare 대시보드 → **Storage & Databases → D1 SQL database → Create database** (이름: `adofai-analyzer`).
2. 만든 DB의 **Console** 탭에 `schema.sql` 내용을 통째로 붙여 넣고 실행합니다. (여러 번 실행해도 안전)
3. **Workers & Pages → (Pages 프로젝트) → Settings → Bindings → Add → D1 database**.
   Variable name 은 반드시 **`DB`**, 값은 위에서 만든 DB를 고르고 저장합니다.
4. 다시 배포합니다 (Deployments 에서 Retry deployment, 또는 아무 파일이나 커밋).

동작과 규칙
- 비밀번호는 PBKDF2-SHA256(10만 회) + 사용자별 소금값으로 저장하고, 로그인은 무작위 토큰 쿠키(HttpOnly, 30일)입니다. DB에는 토큰 원본 대신 해시만 저장합니다.
- ID 8~32자(영문·숫자·특수문자), 비밀번호 7~14자(영문·숫자·특수기호 모두 포함), 닉네임 1~30자. ID와 닉네임은 대소문자를 구분하지 않고 중복을 막습니다.
- 비밀번호를 5번 연속 틀리면 그 계정은 5분간 로그인이 잠깁니다.
- 이메일이 없어서 **비밀번호 찾기는 없습니다.** (분실 시 D1 콘솔에서 해당 계정을 지우고 다시 가입)
- 계정 목록 확인: D1 콘솔에서 `SELECT id, nick, created_at FROM users;`
- 주의: `wrangler.toml` 을 저장소에 넣으면 대시보드에서 설정한 Bindings 가 무시될 수 있으니 넣지 마세요.

## 공지사항 · 관리자 페이지
- 공지는 `notices.json`(파일로 직접 작성) + 관리자 페이지에서 쓴 공지(D1 `notices` 표)를 합쳐 보여줍니다. 같은 id면 서버 쪽이 우선하고, `숨김` 을 켜면 목록에서 빠집니다.
- 관리자 페이지: `admin.html` (로그인 후 상단 **관리자** 버튼으로도 이동). 대시보드, 공지 작성/수정/삭제, 회원 목록·삭제를 지원합니다.
- 설정 방법
  1. D1 콘솔에서 최신 `schema.sql` 을 다시 실행합니다 (`notices` 표 추가, 여러 번 실행해도 안전).
  2. Cloudflare Pages → Settings → **Variables and Secrets** 에 `ADMIN_IDS` 를 추가하고 값에 관리자로 쓸 계정 ID를 적습니다 (여러 명이면 쉼표로 구분, 대소문자 무시).
  3. 다시 배포합니다.
- 권한 검사는 서버에서 하므로 `admin.html` 을 열어도 관리자가 아니면 아무것도 할 수 없습니다. 관리자 본인 계정과 다른 관리자는 삭제할 수 없습니다.

## 맵 테스트 (player.html)
`.adofai` 맵 파일을 불러와 **오토 재생**으로 미리 볼 수 있는 페이지입니다. (메인 화면의 **맵 테스트** 버튼, 직접 플레이 기능은 없음)
- 맵 파일과 음악 파일(mp3/ogg/wav)을 버튼이나 끌어다 놓기로 불러옵니다. 파일은 서버로 올라가지 않고 브라우저에서만 처리됩니다.
- 적용되는 것: 타일 배치, BPM 변화(SetSpeed), Twirl, Pause, Hold, 미드스핀, 카메라(MoveCamera), 타일 이동(MoveTrack/PositionTrack), 트랙 색(ColorTrack/RecolorTrack), Flash, 화면 흔들림, 배경색, 일부 필터, 블룸(근사)
- 적용되지 않는 것: 데코레이션(이미지/텍스트), 배경 이미지, 일부 필터, 멀티플래닛 등. 어떤 이벤트가 적용/미적용인지는 **정보** 버튼에서 확인합니다.
- 음악이 어긋나면 하단 **싱크(ms)** 값으로 맞춥니다. 단축키: Space 재생/정지, ←/→ 5초 이동(Shift 1초).

## 주소 설정
`app.js` 맨 위 `CONFIG` 의 `TUF_URL`, `LEVELS_URL`, `LEVEL_PAGE` 를 필요하면 수정하세요.

## 참고 / 한계
- D1 을 연결하지 않으면 **계정과 저장 목록은 브라우저의 localStorage에만 저장**됩니다. 서버가 없으므로 다른 기기·브라우저와 공유되지 않고, 실제 보안 수준의 인증이 아닙니다. 실서비스로 확장하려면 Supabase, Firebase 같은 백엔드로 `Auth` / `Saved` 부분만 교체하면 됩니다.
- PGU 난이도와 레거시 난이도는 레벨마다 각각 입력해야 합니다 (자동 변환 없음).
- 레거시 난이도 단계는 `app.js`의 `LEGACY` 배열에서 조정할 수 있습니다.

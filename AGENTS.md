# AGENTS.md - Development Guide for news-trader

## Project Overview

Automated economic events trading bot for the **IG Broker** platform. Implements a strangle options strategy (Put + Call on US Tech 100 / Nasdaq 100) around scheduled macroeconomic events. Controlled via Telegram bot commands.

## Tech Stack

- **Language**: TypeScript (strict mode, target ES2021, CommonJS)
- **Runtime**: Node.js ^20.19.5
- **Package Manager**: Yarn (v1)
- **Key Libraries**: Telegraf (Telegram), Winston (logging), node-config (configuration), dotenv (env vars)
- **Testing**: Jest + ts-jest
- **Linting**: ESLint (flat config) + Prettier (experimental ternaries)
- **Git Hooks**: Husky + lint-staged

## Development Commands

| Command              | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| `yarn install`       | Install dependencies                                        |
| `yarn dev`           | Start dev server with hot reload                            |
| `yarn build`         | Compile TypeScript to `build/`                              |
| `yarn start`         | Run production build                                        |
| `yarn test`          | Run Jest tests                                              |
| `yarn test:watch`    | Jest in watch mode                                          |
| `yarn test:coverage` | Jest with coverage                                          |
| `yarn lint`          | Run ESLint                                                  |
| `yarn type-check`    | TypeScript type checking (no emit)                          |
| `yarn qc`            | **Full quality check**: lint + type-check + prettier + test |

**Always run `yarn qc` before committing.** All four checks must pass.

## Architecture

```
MyTradingBotApp (Orchestrator - src/index.ts)
  ├── Trader (Core trading logic - src/trader.ts)
  │     ├── APIClient (IG Trading API - src/ig-trading-api.ts)
  │     └── TradingMetrics (Metrics - src/metrics.ts)
  ├── TelegramCommandHandler (Bot commands - src/telegram-command-handler.ts)
  ├── HealthCheckService (Monitoring - src/health-check.ts)
  └── ConfigValidator (Startup validation - src/config-validator.ts)
```

### State Machine (Trader)

States: `Idle` → `Dealing` → `Position` → `Won` → `Idle`

Each state has its own processing method. Main loop uses `setTimeout` chains (not `setInterval`) with a `checkGuard` to prevent re-entrancy.

### Configuration

Uses `node-config` with environment-based merging:

1. `config/default.json` - Base config
2. `config/production.json` / `config/development.json` - Environment overrides
3. `config/local.json` - Docker-injected local overrides (not committed)
4. Environment variables via `config/custom-environment-variables.json`

## Code Conventions

### TypeScript Rules (enforced by ESLint)

- **Explicit return types** on all functions (`@typescript-eslint/explicit-function-return-type: error`)
- **No floating promises** - all promises must be handled (`@typescript-eslint/no-floating-promises: error`)
- **`async` only when needed** (`@typescript-eslint/require-await: error`)
- **Strict mode** enabled (`"strict": true` in tsconfig)
- Explicit `any` is allowed (`no-explicit-any: off`)
- Non-null assertions are allowed (`no-non-null-assertion: off`)
- Unused vars with `_` prefix are allowed

### Error Handling

Custom error hierarchy in `src/errors.ts`:

```none
TradingError (base)
  ├── ValidationError (with field name)
  ├── ConfigurationError (with config key)
  └── ApiError (with status code and cause)
```

Always use the appropriate error class. Never throw generic `Error`.

### Project Structure

- **Flat `src/` directory** - no nested subdirectories (except `__tests__/`)
- Tests go in `src/__tests__/`
- Test files: `*.test.ts` or `*.spec.ts`

### Style

- Prettier with `experimentalTernaries: true` (uses `a ? b : c` ternary style)
- ESLint flat config format (ESLint v9+)
- Logger: use `gLogger` singleton (never raw `console.log` in production code)
- Metrics: use `metrics` singleton from `src/metrics.ts`

### Patterns

- **Singleton exports** for logger and metrics
- **Polling-based event loop** with `setTimeout` chains
- **Dependency injection** via constructor (config objects passed in)
- **Promise chaining** with `.catch()` for error handling at call sites

## Testing

- Framework: Jest 30 + ts-jest
- Test location: `src/__tests__/`
- Test pattern: `**/?(*.)+(spec|test).ts`
- Run: `yarn test` (includes `--detectOpenHandles --forceExit`)
- Coverage: `src/**/*.ts` (excludes `.d.ts`, `__tests__/`, `index.ts`)

### Writing Tests

- Mock `config` module using `jest.mock('config')`
- Mock `Date` for time-dependent tests
- Test both happy paths and error cases
- No integration tests (API-dependent tests are avoided)

## Environment Variables

Required in `.env` (mapped via `config/custom-environment-variables.json`):

- `IG_API_KEY`, `IG_API_USERNAME`, `IG_API_PASSWORD` - IG broker credentials
- `TELEGRAM_API_KEY`, `TELEGRAM_CHAT_ID` - Telegram bot credentials
- `TZ` - Timezone

## Critical Warnings

1. **Never commit `.env`** - contains real API credentials and Telegram tokens
2. **Never commit `test.sh` or `test.json`** - contain hardcoded credentials
3. **`config/local.json`** is Docker-injected, not committed
4. **Do not add comments to code** unless explicitly asked
5. **No new dependencies** without checking existing ones first
6. **Follow existing patterns** - check neighboring files before writing new code
7. **All promises must be handled** - ESLint will fail on floating promises
8. **Return types are mandatory** on all functions

# News Trader

A sophisticated economic events trading bot for IG broker implementing "Tony's Millionaire Fastlane (TMF)" strategy with enterprise-grade reliability and monitoring.

## 🚀 Features

### Trading Strategy

- **Automated Options Trading**: Trades index vanilla options on economic events
- **Strangle Strategy**: Implements TMF strategy with configurable parameters
- **Risk Management**: Built-in stop-loss and trailing stop mechanisms
- **Event-Driven**: Trades based on scheduled macro economic events

### 🛡️ Safety & Reliability

- **Input Validation**: Comprehensive parameter validation with safety limits
- **Configuration Validation**: Startup validation prevents invalid configurations
- **Error Boundaries**: Robust error handling around all API operations
- **Retry Logic**: Exponential backoff for API calls with smart error detection
- **Health Monitoring**: Real-time system health checks and monitoring

### 📊 Monitoring & Observability

- **Health Checks**: API connectivity, trader status, account access, system resources
- **Metrics Collection**: Counters, gauges, histograms, and timers for all operations
- **Prometheus Export**: Built-in Prometheus metrics format support
- **Telegram Integration**: Full bot control and monitoring via Telegram

### 🏗️ Architecture

- **Modular Design**: Separated concerns with dedicated classes
- **Type Safety**: Full TypeScript implementation with strict typing
- **Error Handling**: Custom error classes with proper error propagation
- **Logging**: Comprehensive logging with multiple output formats

## 📋 Requirements

- **Node.js**: ^20.12.2
- **IG Trading Account**: Valid IG broker account with API access
- **Telegram Bot** (optional): For remote control and monitoring

## 🔧 Installation

```bash
# Clone the repository
git clone https://github.com/rylorin/news-trader.git
cd news-trader

# Install dependencies
yarn install

# Copy and configure environment
cp .env.example .env
# Edit .env with your credentials

# Configure trading parameters
# Edit config/default.json or create config/production.json
```

## ⚙️ Configuration

### Required Configuration

```json
{
  "ig-api": {
    "url": "https://api.ig.com/gateway/deal/",
    "api-key": "your-ig-api-key",
    "username": "your-username",
    "password": "your-password"
  },
  "trader": {
    "market": "Options (US Tech 100)",
    "underlying": "US Tech 100 Barrières",
    "currency": "USD",
    "delta": 55,
    "budget": 100,
    "delay": -5,
    "sampling": 30,
    "stopLevel": 0.5,
    "trailingStopLevel": 0.2
  }
}
```

### Safety Limits

- **Budget**: 0.01 - 10,000 (currency units)
- **Delta**: 1 - 1,000 (points from underlying)
- **Stop Levels**: 0.01 - 0.99 (percentage)
- **Sampling**: 1 - 3,600 (seconds)
- **Currency**: Must be 3-letter code (USD, EUR, etc.)

## 🚀 Usage

### Development

```bash
# Start in development mode with hot reload
yarn dev

# Type checking
yarn type-check

# Linting
yarn lint

# Run tests
yarn test

# Test with coverage
yarn test:coverage
```

### Production

```bash
# Build the application
yarn build

# Start in production mode
yarn start
```

## 🤖 Telegram Commands

| Command              | Description                       | Example                        |
| -------------------- | --------------------------------- | ------------------------------ |
| `/help`              | Show available commands           | `/help`                        |
| `/status`            | Show bot status and configuration | `/status`                      |
| `/health`            | Show system health status         | `/health`                      |
| `/pause [on/off]`    | Pause or resume trading           | `/pause on`                    |
| `/event <time>`      | Set next trading event            | `/event +30` or `/event 14:30` |
| `/budget <amount>`   | Set trading budget                | `/budget 500`                  |
| `/delta <points>`    | Set strike distance               | `/delta 50`                    |
| `/stoplevel <ratio>` | Set stop loss level               | `/stoplevel 0.4`               |
| `/positions`         | Show current positions            | `/positions`                   |
| `/close [leg]`       | Close positions                   | `/close` or `/close put`       |
| `/account`           | Show account balance              | `/account`                     |
| `/explain`           | Explain current strategy          | `/explain`                     |

## 🏗️ Architecture

### Core Components

#### [`MyTradingBotApp`](src/index.ts)

- Main application orchestrator
- Telegram bot integration
- Lifecycle management

#### [`Trader`](src/trader.ts)

- Core trading logic implementation
- Position management
- Risk management rules

#### [`TelegramCommandHandler`](src/telegram-command-handler.ts)

- Handles all Telegram bot commands
- Input validation and error handling
- User-friendly error messages

#### [`APIClient`](src/ig-trading-api.ts)

- IG Trading API wrapper
- Session management with auto-refresh
- Built-in retry logic with exponential backoff

### Safety & Monitoring

#### [`ConfigValidator`](src/config-validator.ts)

- Startup configuration validation
- Parameter safety checks
- API credential validation

#### [`HealthCheckService`](src/health-check.ts)

- System health monitoring
- API connectivity checks
- Resource usage monitoring
- Account balance validation

#### [`MetricsCollector`](src/metrics.ts)

- Performance metrics collection
- Trading operation tracking
- Prometheus format export
- Memory-efficient storage

#### [`RetryHelper`](src/retry-helper.ts)

- Exponential backoff retry logic
- Smart error classification
- Configurable retry policies
- Jitter support

### Error Handling

#### [`Custom Error Classes`](src/errors.ts)

- `TradingError`: Base trading error
- `ValidationError`: Parameter validation errors
- `ConfigurationError`: Configuration issues
- `ApiError`: API communication errors

## 📊 Monitoring

### Health Checks

- **API Connection**: Response time and connectivity
- **Trader Status**: Configuration and operational state
- **Account Access**: Balance and permissions
- **System Resources**: Memory usage and uptime

### Metrics

- **API Calls**: Success/failure rates and response times
- **Trading Operations**: Buy/sell counts, sizes, and prices
- **Positions**: Open position counts and values
- **Errors**: Error rates by type and component
- **Health Checks**: Status and duration tracking

### Logging

- **Console**: Colored output for development
- **File**: CSV format for analysis (logs/newstrader.csv)
- **Telegram**: Critical alerts and notifications

## 🔒 Security

- **HTTPS Only**: All API communications use HTTPS
- **Credential Validation**: Startup validation of API credentials
- **Parameter Bounds**: All trading parameters have safety limits
- **Error Isolation**: Errors don't crash the application
- **Session Management**: Automatic token refresh and reconnection

## 🧪 Testing

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Generate coverage report
yarn test:coverage
```

### Test Coverage

- **Configuration Validation**: Parameter validation and error cases
- **Utility Functions**: Event parsing, type conversions, formatting
- **Error Handling**: Custom error classes and propagation
- **Trading Logic**: Core trading calculations and validations

## 📈 Performance

### Optimizations

- **Single API Connection**: Persistent connection with session management
- **Efficient Polling**: Configurable sampling intervals
- **Memory Management**: Automatic cleanup of old metrics and logs
- **Retry Logic**: Smart retry with exponential backoff
- **Health Monitoring**: Proactive issue detection

### Resource Usage

- **Memory**: Typically < 100MB with automatic cleanup
- **CPU**: Low impact with configurable polling intervals
- **Network**: Minimal API calls with intelligent caching

## 🚨 Risk Management

### Built-in Safeguards

- **Budget Limits**: Maximum 10,000 currency units
- **Stop Loss**: Configurable percentage-based stops
- **Trailing Stops**: Protect profits with trailing stops
- **Position Sizing**: Automatic position sizing based on budget
- **Market Hours**: Respects trading session limitations

### Monitoring Alerts

- **Low Balance**: Account balance below trading requirements
- **API Issues**: Connection problems or authentication failures
- **High Memory**: Resource usage above thresholds
- **Trading Errors**: Failed trades or position management issues

## 📝 Development

### Code Quality

- **TypeScript**: Full type safety with strict mode
- **ESLint**: Comprehensive linting rules
- **Prettier**: Consistent code formatting
- **Husky**: Pre-commit hooks for quality checks

### Project Structure

```
src/
├── index.ts                    # Main application entry point
├── trader.ts                   # Core trading logic
├── ig-trading-api.ts          # IG API client
├── telegram-command-handler.ts # Telegram bot commands
├── health-check.ts            # Health monitoring
├── metrics.ts                 # Metrics collection
├── retry-helper.ts            # Retry logic
├── config-validator.ts        # Configuration validation
├── errors.ts                  # Custom error classes
├── logger.ts                  # Logging system
├── utils.ts                   # Utility functions
└── __tests__/                 # Unit tests
```

## 📄 License

Licensed - See license file for details.

## 👨‍💻 Author

Ronan-Yann Lorin <ryl@free.fr>

---

**⚠️ Disclaimer**: This software is for educational and research purposes. Trading involves substantial risk of loss. Use at your own risk and never trade with money you cannot afford to lose.

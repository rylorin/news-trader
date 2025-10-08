import { util } from "config";
import { ConfigValidator } from "../config-validator";
import { ConfigurationError } from "../errors";

// Mock config object
const createMockConfig = (overrides: Record<string, any> = {}) => ({
  has: (key: string) => key in mockConfigData,
  get: (key: string) => mockConfigData[key],
  util: null as unknown as typeof util,
  ...overrides,
});

let mockConfigData: Record<string, any>;

describe("ConfigValidator", () => {
  beforeEach(() => {
    mockConfigData = {
      "ig-api.url": "https://api.ig.com/gateway/deal/",
      "ig-api.api-key": "valid-api-key-12345",
      "ig-api.username": "testuser",
      "ig-api.password": "testpassword123",
      "trader.market": "Options (US Tech 100)",
      "trader.underlying": "US Tech 100 Barrières",
      "trader.currency": "USD",
      "trader.delta": 55,
      "trader.budget": 100,
      "trader.delay": -5,
      "trader.sampling": 30,
      "trader.stopLevel": 0.5,
      "trader.trailingStopLevel": 0.2,
    };
  });

  describe("validate", () => {
    it("should pass validation with valid configuration", () => {
      const config = createMockConfig();
      expect(() => ConfigValidator.validate(config)).not.toThrow();
    });

    it("should throw ConfigurationError for missing required key", () => {
      delete mockConfigData["ig-api.api-key"];
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Missing required configuration: ig-api.api-key",
      );
    });

    it("should throw ConfigurationError for invalid budget (negative)", () => {
      mockConfigData["trader.budget"] = -100;
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Budget must be positive",
      );
    });

    it("should throw ConfigurationError for budget exceeding safety limit", () => {
      mockConfigData["trader.budget"] = 15000;
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Budget exceeds safety limit of 10,000",
      );
    });

    it("should throw ConfigurationError for invalid delta", () => {
      mockConfigData["trader.delta"] = -10;
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Delta must be positive",
      );
    });

    it("should throw ConfigurationError for invalid stop level", () => {
      mockConfigData["trader.stopLevel"] = 1.5;
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Stop level must be between 0 and 1",
      );
    });

    it("should throw ConfigurationError for invalid currency format", () => {
      mockConfigData["trader.currency"] = "DOLLAR";
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Currency must be a 3-letter code",
      );
    });

    it("should throw ConfigurationError for non-HTTPS API URL", () => {
      mockConfigData["ig-api.url"] = "http://api.ig.com/gateway/deal/";
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "API URL must use HTTPS",
      );
    });

    it("should throw ConfigurationError for placeholder API key", () => {
      mockConfigData["ig-api.api-key"] = "provide a valid IG API key";
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Invalid or placeholder API key",
      );
    });

    it("should throw ConfigurationError for invalid sampling interval", () => {
      mockConfigData["trader.sampling"] = 0;
      const config = createMockConfig();

      expect(() => ConfigValidator.validate(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validate(config)).toThrow(
        "Sampling interval must be at least 1 second",
      );
    });
  });

  describe("validateNumericConfig", () => {
    it("should pass validation for valid numeric values", () => {
      const config = createMockConfig();
      expect(() => ConfigValidator.validateNumericConfig(config)).not.toThrow();
    });

    it("should throw ConfigurationError for non-numeric budget", () => {
      mockConfigData["trader.budget"] = "not-a-number";
      const config = createMockConfig();

      expect(() => ConfigValidator.validateNumericConfig(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validateNumericConfig(config)).toThrow(
        "Configuration trader.budget must be a valid number",
      );
    });

    it("should throw ConfigurationError for NaN delta", () => {
      mockConfigData["trader.delta"] = NaN;
      const config = createMockConfig();

      expect(() => ConfigValidator.validateNumericConfig(config)).toThrow(
        ConfigurationError,
      );
      expect(() => ConfigValidator.validateNumericConfig(config)).toThrow(
        "Configuration trader.delta must be a valid number",
      );
    });
  });
});

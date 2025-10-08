import { ValidationError } from "../errors";
import { LegTypeEnum } from "../trader";
import {
  formatObject,
  oppositeLeg,
  parseEvent,
  string2boolean,
} from "../utils";

describe("Utils", () => {
  describe("parseEvent", () => {
    beforeEach(() => {
      // Mock Date.now() to return a consistent timestamp
      jest.spyOn(Date, "now").mockReturnValue(1609459200000); // 2021-01-01 00:00:00 UTC
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should parse 'now' correctly", () => {
      const result = parseEvent("now");
      expect(result).toBe(1609459200000);
    });

    it("should parse 'none' as undefined", () => {
      const result = parseEvent("none");
      expect(result).toBeUndefined();
    });

    it("should parse relative time correctly", () => {
      const result = parseEvent("+30");
      expect(result).toBe(1609459200000 + 30 * 60000); // +30 minutes
    });

    it("should throw ValidationError for invalid relative time", () => {
      expect(() => parseEvent("+invalid")).toThrow(ValidationError);
      expect(() => parseEvent("+invalid")).toThrow("Invalid minutes format");
    });

    it("should throw ValidationError for empty string", () => {
      expect(() => parseEvent("")).toThrow(ValidationError);
      expect(() => parseEvent("")).toThrow(
        "Event text must be a non-empty string",
      );
    });

    it("should throw ValidationError for invalid time format", () => {
      expect(() => parseEvent("25:70")).toThrow(ValidationError);
      expect(() => parseEvent("25:70")).toThrow("Invalid time format");
    });

    it("should reject events scheduled too far in advance", () => {
      expect(() => parseEvent("+1500")).toThrow(ValidationError);
      expect(() => parseEvent("+1500")).toThrow(
        "Event cannot be scheduled more than 24 hours in advance",
      );
    });
  });

  describe("oppositeLeg", () => {
    it("should return Call for Put", () => {
      expect(oppositeLeg(LegTypeEnum.Put)).toBe(LegTypeEnum.Call);
    });

    it("should return Put for Call", () => {
      expect(oppositeLeg(LegTypeEnum.Call)).toBe(LegTypeEnum.Put);
    });
  });

  describe("string2boolean", () => {
    it("should return true for 'true'", () => {
      expect(string2boolean("true")).toBe(true);
    });

    it("should return true for 'on'", () => {
      expect(string2boolean("on")).toBe(true);
    });

    it("should return true for 'yes'", () => {
      expect(string2boolean("yes")).toBe(true);
    });

    it("should return false for 'false'", () => {
      expect(string2boolean("false")).toBe(false);
    });

    it("should return false for 'off'", () => {
      expect(string2boolean("off")).toBe(false);
    });

    it("should handle boolean input", () => {
      expect(string2boolean(true)).toBe(true);
      expect(string2boolean(false)).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(string2boolean("TRUE")).toBe(true);
      expect(string2boolean("FALSE")).toBe(false);
    });
  });

  describe("formatObject", () => {
    it("should format simple object", () => {
      const obj = { name: "test", value: 42 };
      const result = formatObject(obj);
      expect(result).toContain('"name": "test"');
      expect(result).toContain('"value": 42');
    });

    it("should handle undefined", () => {
      const result = formatObject(undefined);
      expect(result).toBe("undefined");
    });

    it("should handle null", () => {
      const result = formatObject(null);
      expect(result).toBe("null");
    });

    it("should handle Map objects", () => {
      const map = new Map([
        ["key1", "value1"],
        ["key2", "value2"],
      ]);
      const result = formatObject(map);
      expect(result).toContain("key1");
      expect(result).toContain("value1");
    });
  });
});

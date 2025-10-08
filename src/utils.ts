import { ValidationError } from "./errors";
import { LegType, LegTypeEnum } from "./trader";

/**
 * @internal
 *
 * JSON replace function to convert ES6 Maps to tuple arrays.
 */
function jsonReplacer(key: string, value: any): any {
  if (value instanceof Map) {
    const tuples: [unknown, unknown][] = [];
    value.forEach((v, k) => {
      tuples.push([k, v]);
    });
    return tuples;
  } else {
    return value;
  }
}

/**
 * Convert an object (JSON formatted) to string.
 */
export function formatObject(obj: unknown): string {
  return `${JSON.stringify(obj, jsonReplacer, 2)}`;
}

export function string2boolean(text: string | boolean): boolean {
  if (typeof text == "boolean") return text;
  const bool: string = text.trim().toLowerCase();
  return bool == "true" || bool == "on" || bool == "yes";
}

export function oppositeLeg(leg: LegType): LegType {
  switch (leg) {
    case LegTypeEnum.Put:
      return LegTypeEnum.Call;
    case LegTypeEnum.Call:
      return LegTypeEnum.Put;
  }
}

export function parseEvent(text: string): number | undefined {
  if (!text || typeof text !== "string") {
    throw new ValidationError("Event text must be a non-empty string", "event");
  }

  const now = Date.now();
  let event: number | undefined;

  switch (text.toLowerCase().trim()) {
    case "now":
      event = now;
      break;
    case "none":
    case "off":
    case "undefined":
      event = undefined;
      break;
    default:
      if (text.startsWith("+")) {
        const minsStr = text.substring(1);
        const mins = parseInt(minsStr);
        if (isNaN(mins) || mins < 0) {
          throw new ValidationError(
            "Invalid minutes format. Use +N where N is a positive number",
            "event",
          );
        }
        if (mins > 1440) {
          // More than 24 hours
          throw new ValidationError(
            "Event cannot be scheduled more than 24 hours in advance",
            "event",
          );
        }
        event = now + mins * 60_000;
      } else if (text.length < 10) {
        // Short time format like "14:30"
        if (!/^\d{1,2}:\d{2}$/.test(text)) {
          throw new ValidationError(
            "Invalid time format. Use HH:MM format",
            "event",
          );
        }
        const s = new Date().toISOString().substring(0, 11) + text;
        const parsedTime = new Date(s).getTime();
        if (isNaN(parsedTime)) {
          throw new ValidationError("Invalid time format", "event");
        }
        // Only events in the future are accepted
        event = parsedTime > now ? parsedTime : undefined;
      } else {
        // Full datetime format
        const parsedTime = new Date(text.toUpperCase()).getTime();
        if (isNaN(parsedTime)) {
          throw new ValidationError("Invalid datetime format", "event");
        }
        // Only events in the future are accepted
        event = parsedTime > now ? parsedTime : undefined;
      }
  }
  return event;
}

export function deepCopy(object: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(object)) as Record<string, any>;
}

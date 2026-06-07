import { describe, expect, it } from "vitest";

import { weatherPreviewStateForCycle } from "./createWeatherPreviewSystem";

describe("weatherPreviewStateForCycle", () => {
  it("keeps rain and snow to one-minute windows separated by ten-minute clear windows", () => {
    expect(weatherPreviewStateForCycle(30)).toEqual({ rain: 1, snow: 0 });
    expect(weatherPreviewStateForCycle(60)).toEqual({ rain: 0, snow: 0 });
    expect(weatherPreviewStateForCycle(60 + 599)).toEqual({ rain: 0, snow: 0 });

    expect(weatherPreviewStateForCycle(60 + 600 + 30)).toEqual({ rain: 0, snow: 1 });
    expect(weatherPreviewStateForCycle(60 + 600 + 60)).toEqual({ rain: 0, snow: 0 });
    expect(weatherPreviewStateForCycle(60 + 600 + 60 + 599)).toEqual({ rain: 0, snow: 0 });
  });

  it("fades precipitation in and out inside each one-minute weather window", () => {
    expect(weatherPreviewStateForCycle(0).rain).toBe(0);
    expect(weatherPreviewStateForCycle(4).rain).toBeGreaterThan(0);
    expect(weatherPreviewStateForCycle(4).rain).toBeLessThan(1);
    expect(weatherPreviewStateForCycle(56).rain).toBeGreaterThan(0);
    expect(weatherPreviewStateForCycle(56).rain).toBeLessThan(1);

    const snowStart = 60 + 600;
    expect(weatherPreviewStateForCycle(snowStart).snow).toBe(0);
    expect(weatherPreviewStateForCycle(snowStart + 4).snow).toBeGreaterThan(0);
    expect(weatherPreviewStateForCycle(snowStart + 4).snow).toBeLessThan(1);
    expect(weatherPreviewStateForCycle(snowStart + 56).snow).toBeGreaterThan(0);
    expect(weatherPreviewStateForCycle(snowStart + 56).snow).toBeLessThan(1);
  });
});

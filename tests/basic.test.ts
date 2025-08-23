import { describe, it, expect } from "vitest";

describe("basic test", () => {
  it("should pass a simple test", () => {
    expect(1 + 1).toBe(2);
  });
  
  it("should work with async functions", async () => {
    const result = await Promise.resolve("hello");
    expect(result).toBe("hello");
  });
  
  it("should work with TypeScript types", () => {
    const obj: { name: string; age: number } = {
      name: "test",
      age: 42
    };
    
    expect(obj.name).toBe("test");
    expect(obj.age).toBe(42);
  });
});
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library registers its own afterEach cleanup only with
// `globals: true`, which this package does not use.
afterEach(cleanup);

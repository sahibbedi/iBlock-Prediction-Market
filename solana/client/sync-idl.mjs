import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("idl", { recursive: true });
copyFileSync("target/idl/ibpm.json", "idl/ibpm.json");
copyFileSync("target/types/ibpm.ts", "idl/ibpm.ts");

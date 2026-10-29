// The package's main module. Nothing in n-dx imports it; if anything ever
// does, loaded.log says so.
import { recordLoad } from "./loaded.js";

recordLoad("index");

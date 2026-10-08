import {TomlParser} from './cargo/TomlParser.js';
import {ModuleAssembler} from './cargo/ModuleAssembler.js';
import {CargoWorkspace} from './cargo/CargoWorkspace.js';
import {VirtualFileSystem} from './project/VirtualFileSystem.js';
export const starterFiles = {
  'Cargo.toml': '[package]\nname = "ferrite-demo"\nversion = "0.1.0"\nedition = "2021"\n',
  'src/main.rs': 'mod math;\nfn main() {\n    println!("Hello, Ferrite! {}", math::square(7));\n}\n',
  'src/math.rs': 'pub fn square(value: i32) -> i32 { value * value }\n'
};
export function parseManifest(source, options) { return new TomlParser().parse(source, options); }
export function cargoPlan(files, command = 'check', options) { return new CargoWorkspace(VirtualFileSystem.validate(files)).plan(command, options); }
export function mergeCrateSources(files, entry = 'src/main.rs') { return new ModuleAssembler(files).assemble(entry); }
export function createProject(files = starterFiles) { return VirtualFileSystem.validate(files); }

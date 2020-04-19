import fs = require("fs");
import * as enhancedResolve from "enhanced-resolve";
import {dirname, join, relative} from "path";
import {AST_NODE_TYPES, parse as parseTypeScript} from "@typescript-eslint/typescript-estree";
import {TSExternalModuleReference} from "@typescript-eslint/typescript-estree/dist/ts-estree/ts-estree";

const preconditions = require("preconditions").instance();
const checkArgument = preconditions.checkArgument;

class MappedPath {
    public key = "";
    public value = "";
}

class TypescriptConfig {
    public baseUrl = "";
    public mappedPaths = new Array<MappedPath>();
}


export class TypeScriptDependencyProvider {
    private static readonly PATHSEP_REGEXP = /\\/g;

    private readonly resolver;

    constructor() {
        this.resolver = enhancedResolve.create.sync({
            extensions: [".ts", ".js"],
            modules: []
        });
    }

    public getDependencies(modulePath: string): Array<string> {
        checkArgument(fs.existsSync(modulePath) && fs.statSync(modulePath).isFile());
        const moduleAsString = fs.readFileSync(modulePath, "utf-8");
        const moduleDir = dirname(modulePath);
        const tsconfig = this.loadConfig(moduleDir);

        const dependencies = this.getImportSourcesFromString(moduleAsString);
        return dependencies
            .map(dependency => this.resolve(modulePath, dependency, tsconfig))
            .filter(dependency => dependency !== undefined)
            .map(dependency => dependency.replace(TypeScriptDependencyProvider.PATHSEP_REGEXP, "/"));
    }

    private loadConfig(moduleDir: string): TypescriptConfig {
        const tsconfig = new TypescriptConfig();

        const configPath = TypeScriptDependencyProvider.findConfigFile(moduleDir);
        if (!configPath) {
            return tsconfig;
        }

        const plainConfig = require(configPath);
        if (!plainConfig.compilerOptions) {
            return tsconfig;
        }

        if (plainConfig.compilerOptions.baseUrl) {
            tsconfig.baseUrl = join(dirname(configPath), plainConfig.compilerOptions.baseUrl);
            if (plainConfig.compilerOptions.paths) { // Path mappings require baseUrl property
                this.loadPathMappings(plainConfig, tsconfig);
            }
        }

        return tsconfig;
    }

    private static findConfigFile(currentDir: string): string {
        let parentDir;
        while (true) {
            const configPath = join(currentDir, "tsconfig.json");
            if (fs.existsSync(configPath)) {
                return configPath;
            }
            parentDir = dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
        return null;
    }

    private loadPathMappings(plainConfig: any, tsconfig: TypescriptConfig): void {
        const paths = Object.keys(plainConfig.compilerOptions.paths);
        paths.forEach(path => {
            const mappings = plainConfig.compilerOptions.paths[path];
            this.loadPathMapping(path, mappings, tsconfig);
        });
    }

    private loadPathMapping(path: string, mappings: string[], tsconfig: TypescriptConfig): void {
        path = path.endsWith("/*") ? path.substr(0, path.length - 2) : path;
        mappings.forEach(mapping => {
            mapping = mapping.endsWith("/*") ? mapping.substr(0, mapping.length - 2) : mapping;
            mapping = join(tsconfig.baseUrl, mapping);
            tsconfig.mappedPaths.push({ key: path, value: mapping });
        });
    }

    getImportSourcesFromString(moduleAsString: string): Array<string> {
        const tree = parseTypeScript(moduleAsString);
        let imports = [];
        for (let statement of tree.body) {
            if (statement.type === AST_NODE_TYPES.ImportDeclaration) {
                imports.push(statement.source.value);
            }
            else if (statement.type === AST_NODE_TYPES.TSImportEqualsDeclaration) {
                const moduleReference = statement.moduleReference as TSExternalModuleReference;
                if (moduleReference.expression.type === AST_NODE_TYPES.Literal) {
                    imports.push(moduleReference.expression.value);
                }
            }
        }

        return imports;
    }

    private resolve(modulePath: string, importSource: string, tsconfig: TypescriptConfig) {
        const moduleDir = dirname(modulePath);
        const mappedPath = this.getMappedPathFor(importSource, tsconfig);
        if (mappedPath) {
            return relative(moduleDir, mappedPath);
        }

        const resolvedPath = this.resolvePath(dirname(modulePath), importSource);
        return resolvedPath ? relative(moduleDir, resolvedPath) : undefined;
    }

    private getMappedPathFor(importSource: string, tsconfig: TypescriptConfig): string {
        for (let mapping of tsconfig.mappedPaths) {
            if (importSource.startsWith(mapping.key)) {
                let mappedInputSource = "./" + importSource.substr(mapping.key.length + 1);
                const resolvedPath = this.resolvePath(mapping.value, mappedInputSource);
                if (resolvedPath) {
                    return resolvedPath;
                }
            }
        }

        return undefined;
    }

    private resolvePath(mappedDirectory: string, importSource: string) {
        try {
            return this.resolver(undefined, mappedDirectory, importSource);
        }
        catch (e) {
            return undefined;
        }
    }
}

module.exports = function() {
    return new TypeScriptDependencyProvider();
};

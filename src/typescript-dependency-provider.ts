import fs = require("fs");
import * as enhancedResolve from "enhanced-resolve";
import {dirname, join, relative} from "path";

const preconditions = require("preconditions").instance();
const checkArgument = preconditions.checkArgument;

class MappedPath {
    public key = "";
    public value = "";
}

class TypescriptConfig {
    public mappedPaths = new Array<MappedPath>();
}


/**
 *  Simple implementation to allow processing of TypeScript modules - necessary because
 *  TypeScript compiler output cannot be used since it removes even "important" imports.
 */
export class TypeScriptDependencyProvider {
    private static readonly COMMENT_REGEXP = /(\/\*([^*]|[\r\n]|(\*+([^*\/]|[\r\n])))*\*+\/)|(\/\/.*)/g;
    private static readonly IMPORT_REGEXP = /import(?:["'\s]*([\w*{\s*}\n, ]+)from\s*)?["'\s]*([@\w\/\._-]+)["'\s]*;?;/g;
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
        let moduleAsString = fs.readFileSync(modulePath, "utf-8");
        const moduleDir = dirname(modulePath);
        let tsconfig = this.loadConfig(moduleDir);

        let dependencies = this.getImportSourcesFromString(moduleAsString);
        return dependencies
            .map(dependency => this.resolve(modulePath, dependency, tsconfig))
            .filter(dependency => dependency !== undefined)
            .map(dependency => dependency.replace(TypeScriptDependencyProvider.PATHSEP_REGEXP, "/"));
    }

    private loadConfig(moduleDir: string): TypescriptConfig {
        const configPath = this.findConfigFile(moduleDir);
        if (!configPath) {
            return null;
        }

        const plainConfig = require(configPath);
        if (!plainConfig.compilerOptions) {
            return null;
        }

        const config = new TypescriptConfig();

        if (plainConfig.compilerOptions.baseUrl && plainConfig.compilerOptions.paths) {
            const baseUrl = join(dirname(configPath), plainConfig.compilerOptions.baseUrl);
            this.loadPathMappings(plainConfig, baseUrl, config);
        }

        return config;
    }

    private findConfigFile(currentDir: string): string {
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

    private loadPathMappings(plainConfig: any, baseUrl: string, config: TypescriptConfig) {
        const paths = Object.keys(plainConfig.compilerOptions.paths);
        paths.forEach(path => {
            const mappings = plainConfig.compilerOptions.paths[path];
            this.loadPathMapping(path, mappings, baseUrl, config);
        });
    }

    private loadPathMapping(path: string, mappings: string[], baseUrl: string, config: TypescriptConfig) {
        path = path.endsWith("/*") ? path.substr(0, path.length - 2) : path;
        mappings.forEach(mapping => {
            mapping = mapping.endsWith("/*") ? mapping.substr(0, mapping.length - 2) : mapping;
            mapping = join(baseUrl, mapping);
            config.mappedPaths.push({ key: path, value: mapping });
        });
    }

    getImportSourcesFromString(moduleAsString: string): Array<string> {
        return this.findImportSources(this.removeComments(moduleAsString));
    }

    private removeComments(str: string): string {
        return this.replaceAll(str, TypeScriptDependencyProvider.COMMENT_REGEXP, "");
    }

    private replaceAll(str: string, searchValue: RegExp, replaceValue: string): string {
        let length = str.length;
        str = str.replace(searchValue, replaceValue);
        return str.length === length ? str : this.replaceAll(str, searchValue, replaceValue);
    }

    private findImportSources(moduleString: string): Array<string> {
        let matches = TypeScriptDependencyProvider.match(moduleString, TypeScriptDependencyProvider.IMPORT_REGEXP);
        return matches.filter(match => match.length === 3).map(match => match[2]);
    }

    private static match(str: string, regExp: RegExp): Array<RegExpExecArray> {
        let match: RegExpExecArray;
        let matches: Array<RegExpExecArray> = [];

        while ((match = regExp.exec(str)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (match.index === regExp.lastIndex) {
                regExp.lastIndex++;
            }

            matches.push(match);
        }

        return matches;
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

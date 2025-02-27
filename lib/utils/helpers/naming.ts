import { BaseConfig } from '../interfaces/config';

export class ResourceNaming {
    private static sanitize(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    }

    static generateName(config: BaseConfig, resourceType: string, suffix?: string): string {
        const parts = [
            config.projectName,
            config.environment,
            resourceType
        ];

        if (suffix) {
            parts.push(suffix);
        }

        return this.sanitize(parts.join('-'));
    }

    static generateLogicalId(resourceType: string, name: string): string {
        const sanitizedName = name
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
        return `${sanitizedName}${resourceType}`;
    }
}
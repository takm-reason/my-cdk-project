import { BaseConfig } from '../interfaces/config';

export class ConfigValidator {
    static validateBaseConfig(config: BaseConfig): boolean {
        if (!config.projectName || config.projectName.trim() === '') {
            throw new Error('Project name is required');
        }

        if (!['production', 'staging', 'development'].includes(config.environment)) {
            throw new Error('Invalid environment. Must be one of: production, staging, development');
        }

        return true;
    }

    static validateVpcConfig(config: any): boolean {
        if (!config.maxAzs || config.maxAzs < 2 || config.maxAzs > 3) {
            throw new Error('maxAzs must be 2 or 3');
        }

        if (config.natGateways < 1) {
            throw new Error('At least one NAT Gateway is required');
        }

        if (config.natGateways > config.maxAzs) {
            throw new Error('Number of NAT Gateways cannot exceed number of AZs');
        }

        return true;
    }

    static validateDatabaseConfig(config: any): boolean {
        if (!['aurora-postgresql', 'postgresql'].includes(config.engine)) {
            throw new Error('Invalid database engine');
        }

        if (!config.databaseName || config.databaseName.trim() === '') {
            throw new Error('Database name is required');
        }

        return true;
    }

    static validateEcsConfig(config: any): boolean {
        if (config.cpu < 256 || config.cpu > 4096) {
            throw new Error('CPU units must be between 256 and 4096');
        }

        if (config.memoryLimitMiB < 512 || config.memoryLimitMiB > 30720) {
            throw new Error('Memory must be between 512 and 30720');
        }

        if (config.minCapacity > config.maxCapacity) {
            throw new Error('Minimum capacity cannot be greater than maximum capacity');
        }

        return true;
    }
}
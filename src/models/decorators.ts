import { ExposeOptions, Expose, Type, TypeHelpOptions } from 'class-transformer';

import { addAttribute } from './metadata';

export interface DatastoreOptions {
    noindex?: boolean;
}

/**
 * Decorator to declare a field must be saved into the datastore upon save calls.
 *
 * @param options
 */
export const Persist = (options: ExposeOptions & DatastoreOptions = {}): PropertyDecorator => {
    return (object: any, propertyName?: string | Symbol): void => {
        if (options.noindex === true) {
            addAttribute(object, propertyName as string, { noindex: true });
        }
        Expose(options)(object, propertyName as string);
    };
};

/**
 * Decorator to declare a field must be saved into the datastore upon save calls.
 * The type function is necessary to properly recover the underlying data type upon deserialization.
 *
 * @param typeFunction
 * @param options
 */
export const PersistStruct = (typeFunction?: (type?: TypeHelpOptions) => Function, options: ExposeOptions & DatastoreOptions = {}): PropertyDecorator => {
    return (object: any, propertyName?: string | Symbol): void => {
        Type(typeFunction)(object, propertyName as string);
        Expose(options)(object, propertyName as string);
    };
};

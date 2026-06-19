// Exposes type-fest's types as a global `TypeFest` namespace so ambient vendor
// .d.ts files (JS-Slash-Runner @types) can use `TypeFest.LiteralUnion` etc. as
// bare references. type-fest is ESM-only (no global namespace), so this shim
// re-aliases the specific members the vendor types reference.

import type {
    LiteralUnion as TF_LiteralUnion,
    PartialDeep as TF_PartialDeep,
    PartialDeepOptions,
    Primitive,
    SetRequired as TF_SetRequired,
} from "type-fest";

declare global {
    namespace TypeFest {
        type LiteralUnion<
            LiteralType,
            BaseType extends Primitive = string,
        > = TF_LiteralUnion<LiteralType, BaseType>;
        type PartialDeep<
            T,
            Options extends PartialDeepOptions = {},
        > = TF_PartialDeep<T, Options>;
        type SetRequired<
            BaseType,
            Keys extends keyof BaseType,
        > = TF_SetRequired<BaseType, Keys>;
    }
}

export {};

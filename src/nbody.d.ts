export interface NbodyModule {
  cwrap(
    ident: string,
    returnType: "number" | null,
    argTypes: readonly ("number" | "boolean")[],
  ): (...args: number[]) => number;
}

export default function createNbodyModule(moduleArg?: object): Promise<NbodyModule>;

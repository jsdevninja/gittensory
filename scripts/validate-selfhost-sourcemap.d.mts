export type ValidateSourcemapOptions = {
  bundlePath?: string;
  mapPath?: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
};

export declare function validateSourcemap(options?: ValidateSourcemapOptions): { sourceCount: number };

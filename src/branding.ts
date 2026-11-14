import brandingData from "../branding.json";

export interface BrandingConfig {
  name: string;
  identifier: string;
  version: string;
  description: string;
  windows: {
    island: {
      title: string;
      width: number;
      height: number;
    };
    settings: {
      title: string;
      width: number;
      height: number;
    };
    dynamusic: {
      title: string;
      width: number;
      height: number;
    };
  };
}

export const branding: BrandingConfig = brandingData;

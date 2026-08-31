import { createTheme, rem } from "@mantine/core";

/**
 * Huisstijl van Routeboek.cc / Maximus Stampers:
 * rood #F4244E als hoofdkleur, blauw voor actieknoppen, font Archivo.
 */

export const BRAND_RED = "#F4244E";

export const theme = createTheme({
  primaryColor: "routeboek",
  primaryShade: { light: 6, dark: 6 },
  fontFamily: "Archivo, Helvetica, Arial, sans-serif",
  headings: {
    fontFamily: "Archivo, Helvetica, Arial, sans-serif",
    fontWeight: "700",
  },
  defaultRadius: "md",
  colors: {
    routeboek: [
      "#ffe9ed",
      "#ffd0d8",
      "#fb9fae",
      "#f76b82",
      "#f4415f",
      "#f4244e",
      BRAND_RED,
      "#da1440",
      "#c30c38",
      "#ab002f",
    ],
    action: [
      "#e6f4ff",
      "#cde5ff",
      "#9ac8ff",
      "#64a9ff",
      "#3b8ffe",
      "#2180fe",
      "#0f78fe",
      "#0066e3",
      "#005acb",
      "#004db3",
    ],
  },
  components: {
    Card: {
      defaultProps: {
        shadow: "sm",
        radius: "md",
        withBorder: false,
      },
    },
    Paper: {
      defaultProps: {
        shadow: "xs",
        radius: "md",
      },
    },
    Button: {
      defaultProps: {
        radius: "md",
      },
    },
    Title: {
      styles: {
        root: { letterSpacing: rem(-0.4) },
      },
    },
  },
});

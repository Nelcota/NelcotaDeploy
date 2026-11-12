import { icons } from "@iconify-json/solar";
import plugin from "tailwindcss/plugin";

// Solar Icons by 480 Design, CC BY 4.0 (https://icon-sets.iconify.design/solar/).
const SOLAR_ICON_SIZE = 24;

export default plugin((api) => {
  api.matchUtilities({
    solar: (name) => {
      const icon = Object.hasOwn(icons.icons, name) ? icons.icons[name] : undefined;
      if (icon == null) {
        return {};
      }

      const width = icon.width ?? icons.width ?? SOLAR_ICON_SIZE;
      const height = icon.height ?? icons.height ?? SOLAR_ICON_SIZE;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${icon.body}</svg>`;

      return {
        display: "inline-block",
        backgroundColor: "currentColor",
        mask: `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / contain no-repeat`,
        "@media (forced-colors: active)": {
          backgroundColor: "CanvasText",
          forcedColorAdjust: "none",
        },
      };
    },
  });
});

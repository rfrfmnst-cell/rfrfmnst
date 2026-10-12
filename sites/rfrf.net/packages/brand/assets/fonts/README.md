# Self-hosted Rafraf brand fonts

Rafraf packages its Arabic brand fonts in \`@rafraf/brand\` so customer,
supplier, and admin builds never depend on font-CDN availability. Applications
must load \`@rafraf/brand/styles.css\`; they must not keep their own Alexandria
or IBM Plex Sans Arabic copies.

## Pinned official sources

Alexandria comes from the official
[\`google/fonts\` commit](https://github.com/google/fonts/tree/352f6b7d9d6cc4fa9e242b931291d31b21a6dc84)
\`352f6b7d9d6cc4fa9e242b931291d31b21a6dc84\`.

IBM Plex Sans Arabic comes from the official
[\`IBM/plex\` commit](https://github.com/IBM/plex/tree/bf260093582f04622aacc1e9f9ca604d7ccd0c42)
\`bf260093582f04622aacc1e9f9ca604d7ccd0c42\`.

| Packaged file | Official source path | Git blob SHA | Bytes |
| --- | --- | --- | ---: |
| \`alexandria/Alexandria-Variable.ttf\` | \`google/fonts: ofl/alexandria/Alexandria[wght].ttf\` | \`2c6c226dc74899321d4939f32d55f6acb97a59b2\` | 332,488 |
| \`alexandria/OFL.txt\` | \`google/fonts: ofl/alexandria/OFL.txt\` | \`bf71099c5ad317e98b0502cfb92eb3e8401d5bd6\` | 4,483 |
| \`ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.woff2\` | \`IBM/plex: packages/plex-sans-arabic/fonts/complete/woff2/IBMPlexSansArabic-Regular.woff2\` | \`695d303cc25104463a86fa0b42bad47b27d187bf\` | 71,904 |
| \`ibm-plex-sans-arabic/IBMPlexSansArabic-Medium.woff2\` | \`IBM/plex: packages/plex-sans-arabic/fonts/complete/woff2/IBMPlexSansArabic-Medium.woff2\` | \`ced3646c77cdd8a054e0647ff46dc533e5419fa9\` | 75,936 |
| \`ibm-plex-sans-arabic/IBMPlexSansArabic-SemiBold.woff2\` | \`IBM/plex: packages/plex-sans-arabic/fonts/complete/woff2/IBMPlexSansArabic-SemiBold.woff2\` | \`eda08d3bb808cc95a73244992a8cee8ad7fbcb59\` | 76,408 |
| \`ibm-plex-sans-arabic/OFL.txt\` | \`IBM/plex: packages/plex-sans-arabic/fonts/complete/woff2/license.txt\` | \`f72f76504cd73cf2c00b140b2743c138320597b6\` | 4,360 |

The artifacts are copied byte-for-byte. Alexandria's filename is normalized
for a stable CSS URL; its binary is unchanged. No local format conversion or
subsetting is applied. Each family remains distributed with its own SIL Open
Font License because the copyright and reserved-name notices differ.

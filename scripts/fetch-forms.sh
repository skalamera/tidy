#!/bin/sh
# Downloads the official 2025 fillable PDFs into resources/forms/2025 and checks that each one is the exact
# file the field maps in src/main/pdf/maps were built against. Run from anywhere: sh scripts/fetch-forms.sh
set -eu
cd "$(dirname "$0")/.."
DIR=resources/forms/2025
mkdir -p "$DIR"

fetch() { curl -fsSL -o "$DIR/$1" "$2"; }

# IRS keeps last year's revision under irs-prior/ with a --YEAR suffix, so these URLs never change.
fetch f1040.pdf https://www.irs.gov/pub/irs-prior/f1040--2025.pdf
fetch f1040s1.pdf https://www.irs.gov/pub/irs-prior/f1040s1--2025.pdf
fetch f1040s1a.pdf https://www.irs.gov/pub/irs-prior/f1040s1a--2025.pdf
fetch f1040s2.pdf https://www.irs.gov/pub/irs-prior/f1040s2--2025.pdf
fetch f1040s3.pdf https://www.irs.gov/pub/irs-prior/f1040s3--2025.pdf
fetch f1040sa.pdf https://www.irs.gov/pub/irs-prior/f1040sa--2025.pdf
fetch f1040sb.pdf https://www.irs.gov/pub/irs-prior/f1040sb--2025.pdf
fetch f1040sc.pdf https://www.irs.gov/pub/irs-prior/f1040sc--2025.pdf
fetch f1040sd.pdf https://www.irs.gov/pub/irs-prior/f1040sd--2025.pdf
fetch f1040se.pdf https://www.irs.gov/pub/irs-prior/f1040se--2025.pdf
fetch f1040sse.pdf https://www.irs.gov/pub/irs-prior/f1040sse--2025.pdf
fetch f2210.pdf https://www.irs.gov/pub/irs-prior/f2210--2025.pdf
fetch f4562.pdf https://www.irs.gov/pub/irs-prior/f4562--2025.pdf
fetch f4797.pdf https://www.irs.gov/pub/irs-prior/f4797--2025.pdf
fetch f7203.pdf https://www.irs.gov/pub/irs-pdf/f7203.pdf
fetch f7206.pdf https://www.irs.gov/pub/irs-prior/f7206--2025.pdf
fetch f8582.pdf https://www.irs.gov/pub/irs-prior/f8582--2025.pdf
fetch f8829.pdf https://www.irs.gov/pub/irs-prior/f8829--2025.pdf
fetch f8949.pdf https://www.irs.gov/pub/irs-prior/f8949--2025.pdf
fetch f8959.pdf https://www.irs.gov/pub/irs-prior/f8959--2025.pdf
fetch f8960.pdf https://www.irs.gov/pub/irs-prior/f8960--2025.pdf
fetch f8995.pdf https://www.irs.gov/pub/irs-prior/f8995--2025.pdf
fetch f8995a.pdf https://www.irs.gov/pub/irs-prior/f8995a--2025.pdf
fetch md500dm.pdf https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2025/500dm.pdf
fetch md502.pdf https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2025/502.pdf
fetch md502cg.pdf https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2025/502cg.pdf
fetch md502cr.pdf https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2025/502cr.pdf
fetch md502r.pdf https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2025/502r.pdf
fetch md502su.pdf https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2025/502su.pdf
fetch md502up.pdf https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2025/502up.pdf

cd "$DIR"
shasum -a 256 -c <<'SUMS'
3d31c226df0d189ced80e039d01cf0f8820c1019681a0f0ca6264de277b7e982  f1040.pdf
8dafec719f6a4716c259a2bdaca546d9bb9e262d1eabef885fe116a7327458fa  f1040s1.pdf
64f97b38ff4218e2f188fd55a8aab7043556687487c82bbefe0b6dd1a956ecd4  f1040s1a.pdf
64d867b683334cfc533993e37ccb0d143449ec29428a78206be2e4de333941e8  f1040s2.pdf
008cfd3fe3ebd0860452069b90fd0a3d53dda6dd8a5d870278370aa899a63f82  f1040s3.pdf
c14acf3478f4c33f27ac6e8ecd9f94b6fb25b16745b341728bd27847d2ef56bb  f1040sa.pdf
dd1ec3719954532bd219343d81385a2ada3c8e9573fc755a3893f1fbbecc63e2  f1040sb.pdf
ddf401dbe060467d39f90ad2abf645df1de31512821a150dc68a3882bbf19716  f1040sc.pdf
90564c8b7e49280363612639b804d113ebedb516c2e87c70649f29c844da1d2e  f1040sd.pdf
c5e2c8fa0ec5ee9153a0167734df634afe0ea8bb8483040766e5f4b1b12780f3  f1040se.pdf
05bc2b3e1dfca65d8c6fc6d652af4fa3736e953c6575d6e9f82590484677d347  f1040sse.pdf
6899ce672648b280bf00ab47200f1b0fbf40368cfbf137df507b945b8577159a  f2210.pdf
c05f9d1f5e26b1b21e18b0a13adbbcd3d568bb9f3ca53bd7bba7c795c7799b4a  f4562.pdf
e8ab787f2caab6a5f22894e4d13585afafaefcbc59428b70e590a84ea8cf9b54  f4797.pdf
e138560a8c5d591f1619544cbf189658e6d4540e13e9b3726b6fcd653cb2ad1d  f7203.pdf
822203c9bbd958e651e243bbf6353c4c8e78abbde412e06caf6db5f88fe68ee1  f7206.pdf
d929884fe07b58aca9561aefbfe9fe2196d9e8526b4726e49460589501080537  f8582.pdf
994834c9eeacdb371f5d75e8ed272bda6e9fd601898af57670b6b2c47665890b  f8829.pdf
274513891e4e281d11e14286f14b9df724c24b6030fca0f0681da64fb2e7f525  f8949.pdf
13e64004948331d2b708c80b1b664bf69675028edd0b84f2de6e3ca9afaa996d  f8959.pdf
9b323b7166b5845a776f781b8c82eef94ccd998354e88fc33a1051c3b3789731  f8960.pdf
55380ad230303e1586ce97f0f224265b8337ad18c9204f0fb7325e95a76b5cde  f8995.pdf
3362db81b8ef60cfaa93354858c6c92bac16e63984be0805c6479d272a6ec9aa  f8995a.pdf
f26196b27325dd9dc688fe5b3ec6ae2b1d445a1e01fa6cecc389c2de94f959ca  md500dm.pdf
4f4d604f27cf6995cbab58b7650fd812c0e4ccc9f8d899f04261ded5a04a24cf  md502.pdf
8e0a3f2928d010aef85a28ac5480414875dc6778b4a2f57d3ae099bcddd6055f  md502cg.pdf
7facc0ab593ac252fa1fe8b289e9da34844b2e682c263eb5c6ab15cb5ee9d842  md502cr.pdf
7205c4ec7b65460bfd6e1bab8dbd269d8dad308d537bc3980e1224a78d8be029  md502r.pdf
c00958675a96bed7317d77785459958294bd84f7e193fc7e0b28f18cb1d99fe0  md502su.pdf
4f2b10661a071fe8aa1d4329da5d08a20c00554c40f7ae6fbc9fa4a0694e8510  md502up.pdf
SUMS

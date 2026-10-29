// SPDX-License-Identifier: MIT
// The SHA-256 of every model file whose hash audio.cpp's catalog (seed_audiocpp_catalog.json)
// doesn't carry — seed data, kept out of the family files (curated/<family>.js): the kit's family
// guard takes a quoted SHA-256 outside a seed file for a violation (just-core scripts/check-family.js
// check 21; moved here 2026-10-29). The engine cache names and checks every file by its SHA-256
// (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1); kit_models.js reads these.

// Small files Git stores itself: the catalog carries only Git's blob id for them (40 hex — all
// Hugging Face lists outside LFS). By family, then repository and revision, then path. Each file
// fetched at its revision (2026-10-29), its size and Git blob id checked against the catalog.
export const SMALL_FILES = {
  // F5-TTS: each Habibi download's vocab.txt.
  f5_tts: [
    {
      repo: "trklou/audio.cpp",
      revision: "4c220adc169f56a2012125aaab1ae821d790f6ca",
      sha256: {
        "habibi-unified/vocab.txt": "49b8f3f126a0cb8146cd5a974cd48866acc4b292f8b59546fd51957f83251d5b",
        "habibi-alg/vocab.txt": "a959e14efa69a068f1bd14ad5c335a82e3bcad5083ebd1c72f5c4eb3925f5c4e",
        "habibi-egy/vocab.txt": "ceed48f51f0211ffbb8b36007ead3c9b8698fbda9709f184fd712bd3dcd095c5",
        "habibi-irq/vocab.txt": "55484bc3dda8b8e6a7fbf04261b47a8788d4b553a85b93dc46dac6fd39c9fd88",
        "habibi-mar/vocab.txt": "a49a0b74e12cb91de49a636f59c4045e3a1683d389fa6c223b53024faa9afbea",
        "habibi-msa/vocab.txt": "4de4460ff1ef7cb40c2e564bc1ee2f3198164d10ce71380290986e483ba7e19c",
        "habibi-sau/vocab.txt": "9bd4755a39ee21eafe78f54d6c32ae939f900775427f447598430c795c04362f",
        "habibi-uae/vocab.txt": "6f249cb7a0fcef576d4e0281a9998b30a92048a72616f84020238bf743810d79",
      },
    },
  ],
  // Kitten TTS 2: its licence files and checksum list. The revision is the one the catalog built at our
  // fork's merge of upstream (dacb0d7f) names — the repository's main that day; its five files are byte
  // for byte the ones at be39e32c. (was: 73b762c9, the jv.6 catalog's, and be39e32c, the uncommitted
  // catalog's of 2026-10-18 — until that rebuild.)
  kitten_tts2: [
    {
      repo: "dignome/kitten_tts2",
      revision: "895debc13b2c104d7e89c9c71a57f8f1e7173b12",
      sha256: {
        "LICENSE": "f2429d9172b1e192102ab07552d7ca86c981f13598cbe3b51cc1fbd94604e1a3",
        "NOTICE": "d8d3652f8ff8ebe338fe1259e02659a67ce8dc65f34dca53ce6896fbf07560d8",
        "native/LICENSE": "4248e910a928849fe5815a0f9236e17fa07768d95b9193212752c464b93d6caa",
        "speaker/LICENSE": "14d7016ad68e7394d6e6b78d96cc2ae431c905287b89674cfdf021e79e62b8ba",
        "SHA256SUMS": "ae8039b0e806d7770b7c62566825a72e3d692bb34dfbdcdc400f2991cf47c81f",
      },
    },
  ],
  // sanoTTS: each download's config.json.
  sanotts: [
    {
      repo: "ampixa/sanoTTS",
      revision: "c532a5d21c078a16cb633718e9182bfd71a5b760",
      sha256: {
        "gguf/config.json": "58eabea7a1156d436bf30731a47c86c3f1ec02623ee2a545a7cf042a8517b4dd",
        "gguf/heart/config.json": "0b3ffed9db2975352d662b4648006e1e6dfde9892bd30dcac6fea3d013607dd6",
        "gguf/amy/config.json": "f974432ca8bab93ea07abcee768c649a4e4ee0cfe1b1e88efa886e68702073a4",
        "gguf/hfc/config.json": "efe89a538552742252b1a94e404d30bcebe907829669298b5783ca3b874a745f",
        "gguf/kristin/config.json": "299f51b020fc0982da562e30befd7d88fdb9a384d2783721e314bc473bc1b494",
        "gguf/vi/config.json": "d72b29f8c5dad7e442ba7fdf40232d6fd7cab0a9afd306e6d8ab2894ca0722f0",
        "gguf/id/config.json": "e93d194707cd96a810c455d18ac78398457cc6452c897dcdeb5f7592cb4e248b",
        "gguf/cs/config.json": "02e1e77796be139bb4dea3d1e0784a717a8d3e86463aa8e69ef3595de94822a3",
        "gguf/de/config.json": "6847f38cb3028d1d5854123a879660efba959a2e24b980cb37b2ae1fe0eabb17",
        "gguf/es/config.json": "09b7a90a284e36ffaf0e066bbd87f80cfe284bbb7f53cb5b47bdaae121223206",
        "gguf/fr/config.json": "925a7bb3337f0d0d86076d53601e8de5273dad11d6736446e423453066dcb157",
        "gguf/it/config.json": "020842d2b0e35184413d5c9eddc081b8f6220d938adab5483246d5de2c220133",
        "gguf/pt/config.json": "afeae6f79747d31f0110c40f629e06457301bb7f3e43ce17b60a2e5d1c85e376",
        "gguf/ro/config.json": "43513008d42f78f3e9a2666ff3d89d9f7ba43b1c0ec79c31b6932aa6cefe8a08",
        "gguf/ru/config.json": "3cdc42083c7a14da864c650df6dfc7dff47919f5a54ad5722ffa65ecda20e11b",
        "gguf/tr/config.json": "7895212d23ba27df600192e53b50a83de53231eab661c71a628be2a5a034a35f",
        "gguf/ne/config.json": "334d33da82e46f4a39505fa4adde1696ff5c9772b3c023bf996c1e5338411309",
        "gguf/hi/config.json": "0f4a254235b91de1370519497493a3d118df43acdd3a1922a2069b9c518114d9",
      },
    },
  ],
};

// Pocket TTS's preset voice files (curated/pocket_tts.js `VOICES`, which gives their sizes): no spec
// package names them, so the catalog carries no hash for them. Hugging Face's own LFS ids for the repo
// at the pinned model revision (its API's tree listing, `lfs.oid`, read 2026-10-29). The 79 English,
// German, Spanish and Portuguese files downloaded here before (their `files.json`) carry the same
// ids; the Italian ones were not downloaded. A language's two precisions share its folder, so each
// file is one entry. French has no presets. At the model revision 661a224e every one of the 99 has the id
// it had at f861648c (both tree listings, 2026-10-29). (was: pinned at f861648c — until that move.)
export const POCKET_VOICE_FILES = {
  revision: "661a224e9d9adbd49c01626f85e426f5f425d771",
  sha256: {
    // english
    "PocketTTS-GGUF/english/embeddings/anna.safetensors": "5ea82f78db006c9fd34e32ddd5aae82674b5b32646097977436458d00af80dfa",
    "PocketTTS-GGUF/english/embeddings/azelma.safetensors": "9f3e69f29075f991fd47774566865ef0e0e637cb5a35992c9919761b5b84b1de",
    "PocketTTS-GGUF/english/embeddings/bill_boerst.safetensors": "75610127d44e0b05b442154f80f89f993df235aecc6cad7070f11000d006c188",
    "PocketTTS-GGUF/english/embeddings/caro_davy.safetensors": "a5961b63a2e7a5cfd7edc383aa9042fb70fd14a9dee6310cdc633881a7f2449a",
    "PocketTTS-GGUF/english/embeddings/charles.safetensors": "299edc20182eeccfbf94e308626f259da4fbf339daa8d5905218f2b1774639b8",
    "PocketTTS-GGUF/english/embeddings/eponine.safetensors": "bda3b76a384ff355fe0350736387765946304ae8ca16e59f60ea3296a1c99cc6",
    "PocketTTS-GGUF/english/embeddings/estelle.safetensors": "ccebef7f51762c7fc08870f5ecf268e8713551ae2c9f7984ddaec0c1e1c77153",
    "PocketTTS-GGUF/english/embeddings/eve.safetensors": "ea9c2faf862a6c9d2cb61910fdf02842ae56940382cc8c1000fdb1b43269692b",
    "PocketTTS-GGUF/english/embeddings/fantine.safetensors": "51a8a4355d7f912d4959e4b1918314fda85ad47eba0a33a1d78a4a505d3465f5",
    "PocketTTS-GGUF/english/embeddings/george.safetensors": "0c1c6c57c55a98d81254b33728150c7776f40647fe95258d1a6c1a02780b5d02",
    "PocketTTS-GGUF/english/embeddings/jane.safetensors": "37386227ca8ec5bf1b8e516c13d132ce5ff5437a304fe90129a1c62f41d9a008",
    "PocketTTS-GGUF/english/embeddings/javert.safetensors": "0ae88e03ca4e76a0e16cbf321a807428febda9d9e9bc0358c02e7f9c9e2c263b",
    "PocketTTS-GGUF/english/embeddings/marius.safetensors": "04f84efcb77a0547ba582c058db496f7ff4920891d49d37b9950d128422582a8",
    "PocketTTS-GGUF/english/embeddings/mary.safetensors": "a8f2adf260cab966fe0a113d6b549d6efdeaa79de544ae0ff34b5b6a41445a59",
    "PocketTTS-GGUF/english/embeddings/michael.safetensors": "8937f724ac4719b9aa51ea0ba1f18f9de0af7a663ad6263558266c1a53c9722d",
    "PocketTTS-GGUF/english/embeddings/paul.safetensors": "ed7a019168f94dfe77009f1b0de59387abc6fbb0db954d38ce722ecb77da61aa",
    "PocketTTS-GGUF/english/embeddings/peter_yearsley.safetensors": "dd977a6e15591e347c9a23fa7cc09e35a65b462917f5eeb162baff6dc9e3f685",
    "PocketTTS-GGUF/english/embeddings/stuart_bell.safetensors": "5a49da7ca5df05d02587ec4a0981c0d318e045f68e24423c4203ce474d9b33dc",
    "PocketTTS-GGUF/english/embeddings/vera.safetensors": "4bf50ddd957b5d218b264fdcf18efbbc7384d12da3eca98ca19b9e8dd6976acc",
    // german
    "PocketTTS-GGUF/german/embeddings/alba.safetensors": "b5a1933388634f63f0f709d3139f64d3c78281160d4a3bf6ea3bd1abc3ba94b6",
    "PocketTTS-GGUF/german/embeddings/anna.safetensors": "6aa8e46421e4a8a602976918ed407fde55e7603b313acbe2e4432905b8bee7bc",
    "PocketTTS-GGUF/german/embeddings/azelma.safetensors": "e8fab25e856720159754ecda80a8791d6da09f70cdda32be2eda887e0ff1dcf6",
    "PocketTTS-GGUF/german/embeddings/bill_boerst.safetensors": "b95ed4aab6539920466ed8b8ed1e4f3f21899079345d6f415f48b44faf0e18d3",
    "PocketTTS-GGUF/german/embeddings/caro_davy.safetensors": "caada25a417c0cbdf48a78ae4b00480e1dcd9d7487f41dcd569376e71b9cf245",
    "PocketTTS-GGUF/german/embeddings/charles.safetensors": "c8bbc4a0e46cd0f16df2aaed7dfe811a0ca2d93799837ca4200851db906530b4",
    "PocketTTS-GGUF/german/embeddings/eponine.safetensors": "111350eaf68881da45a08239541b445481756365ac03308234a863f070334f33",
    "PocketTTS-GGUF/german/embeddings/estelle.safetensors": "61285c542f94b345dae0f810a540d4baaca2b0ceb9cd741cd3bd1af993ec74f4",
    "PocketTTS-GGUF/german/embeddings/eve.safetensors": "223f60a58a28236b27ca361e01f182fb919e72f0e3dceffb3bf18f006a0d0097",
    "PocketTTS-GGUF/german/embeddings/fantine.safetensors": "f0c2c0d22f5835c8cf8698cc7cb6ab93778229163eb1c55c86fe7e4ec512501a",
    "PocketTTS-GGUF/german/embeddings/george.safetensors": "bb0ecc9d5524fe64102f44c190be74d2dbee33bcf51f44dbb16e9b6b046496e1",
    "PocketTTS-GGUF/german/embeddings/jane.safetensors": "4572c0d06ce058ecb4f54d5059dcb872b3084d0cef95958faaf73bd4e1ccaf28",
    "PocketTTS-GGUF/german/embeddings/javert.safetensors": "71eed75d77eb0c3f902ef0900401530c06983aa100ea4cdbec036ad607778a16",
    "PocketTTS-GGUF/german/embeddings/marius.safetensors": "7f74e9727ee0ad2698113e07b75e24519c7a180f9ba3b033bd54bc1ef18c5d0f",
    "PocketTTS-GGUF/german/embeddings/mary.safetensors": "476f100e38206c5dff2cb22d582857241b7b718376f65d0ac69b9b0ea9dc1ebb",
    "PocketTTS-GGUF/german/embeddings/michael.safetensors": "6a491e111f277fab05bc05696691d621fd0847ae3b3be9271beb64453970d0f2",
    "PocketTTS-GGUF/german/embeddings/paul.safetensors": "3f74b464af87e9f8ee59895d806d6a2a05b5e7c345491d03177a92bc66a0eede",
    "PocketTTS-GGUF/german/embeddings/peter_yearsley.safetensors": "1cc888975274ecb60968e5c6ffd653f9bc3e9fe5b2527f71df52b1a7b3efba09",
    "PocketTTS-GGUF/german/embeddings/stuart_bell.safetensors": "08d8f183ef1d300acad1b6018d102e862b90d4df64bc79c77e619b99f7a172ce",
    "PocketTTS-GGUF/german/embeddings/vera.safetensors": "53727005ebf05cac548aa372e26f93ca89b883210b904b58449c247a4f5444d1",
    // italian
    "PocketTTS-GGUF/italian/embeddings/alba.safetensors": "7d2bd2e5df41e5ede229857bcc2b56d41856725465260c330ba847e8a945442c",
    "PocketTTS-GGUF/italian/embeddings/anna.safetensors": "2d1bb064780b6b3c4a77a336c51335fde6dd07b506ccf329d2d0872ad6327c5f",
    "PocketTTS-GGUF/italian/embeddings/azelma.safetensors": "bbd40c3dd7d74434e5d274ab87a1e00ea1c06216a3242eec783a7b6c882cf3ba",
    "PocketTTS-GGUF/italian/embeddings/bill_boerst.safetensors": "fb5fc864bf42564a1362df9e37cc169b2570b40a0c7fc11a024b9009a89f5bc2",
    "PocketTTS-GGUF/italian/embeddings/caro_davy.safetensors": "f13fb23a7c105ddeb5908483d6261ded35a2d8b053b97a77af6baf7a6ba4b78a",
    "PocketTTS-GGUF/italian/embeddings/charles.safetensors": "1e4b6dafd17e0bb4489590f821f7083b598bd0dbe6d93bcabc8b72bb383881d5",
    "PocketTTS-GGUF/italian/embeddings/eponine.safetensors": "31259726243a19758b6ba2d6dfa80bae3db70eedd96a183f5ce05d496eff4cdb",
    "PocketTTS-GGUF/italian/embeddings/estelle.safetensors": "7c768f5234601c670917be9a8db2fa005f88d0dc97080fb415ea19c2154ddada",
    "PocketTTS-GGUF/italian/embeddings/eve.safetensors": "6bd49ded51178b6a388bfad57360d4f3b795f89fa7155923efbd968405f01c9f",
    "PocketTTS-GGUF/italian/embeddings/fantine.safetensors": "88a60059c7bed630cb77de4787b473da747e20140dfb93a4ade353c176bae7f1",
    "PocketTTS-GGUF/italian/embeddings/george.safetensors": "c54fd34b252255f61f007fda923d8cb33b3f960b4806335ace0a74c2227a878d",
    "PocketTTS-GGUF/italian/embeddings/jane.safetensors": "56bcf13e73c2143ab431e59be4d4b67ef0cb086ce63626f290a5edcbd1c3fa7f",
    "PocketTTS-GGUF/italian/embeddings/javert.safetensors": "a4f0b3ca1da9b276b0304f67f83342147afd28e823f7dd9775b62cc1c588bba5",
    "PocketTTS-GGUF/italian/embeddings/marius.safetensors": "ed70813d5f48d0b37ab671051fc2226588aec0922bf589f8a2f99fb4db6f199f",
    "PocketTTS-GGUF/italian/embeddings/mary.safetensors": "8cb071cafd9f2490094715ab3dc7c84a5f10b9c0539ab30526a1cce0416696b4",
    "PocketTTS-GGUF/italian/embeddings/michael.safetensors": "3a52c4eb205affd8da5b8d8d2e384328b258f6652f2ad170311bb28f5cdab714",
    "PocketTTS-GGUF/italian/embeddings/paul.safetensors": "c0a1913b9bf224d61d15562c3f1ff778e6ecfb77432c998ce785b3c04a19d9a0",
    "PocketTTS-GGUF/italian/embeddings/peter_yearsley.safetensors": "74cabecedcaa39bafc75d4b8ccf9435c0bd6da0eeb5417d68bc68fb91c406a81",
    "PocketTTS-GGUF/italian/embeddings/stuart_bell.safetensors": "c1438f5e99714fb10ccb1eae17bc00191b076ad753fb85d140575c396e5c1e2e",
    "PocketTTS-GGUF/italian/embeddings/vera.safetensors": "e5e506fda84961dba96295915a9957c4e0c3db00a49f946cd9ec3f7a546a4583",
    // portuguese
    "PocketTTS-GGUF/portuguese/embeddings/alba.safetensors": "855b277ffa0e1f1600acacdb72f4e8609af7db7bbb5236dd904d1472c27541d2",
    "PocketTTS-GGUF/portuguese/embeddings/anna.safetensors": "70ef78480c1d90f502826c10b0512effa34262453e22a76d5992d5fa1e8182bb",
    "PocketTTS-GGUF/portuguese/embeddings/azelma.safetensors": "9abb3ad69fbea053e44faa7c93d62d660b3552157ee02bcefc9157101ef269c2",
    "PocketTTS-GGUF/portuguese/embeddings/bill_boerst.safetensors": "e5ed6c383f0ae3c92d86202d5f20b2cdd424ad3221873f4322728bdf61890cc6",
    "PocketTTS-GGUF/portuguese/embeddings/caro_davy.safetensors": "85ff67e73e0f1c58e573eb10786da410e1fb79fdc71a10989e7bc11690cb8c04",
    "PocketTTS-GGUF/portuguese/embeddings/charles.safetensors": "e643bddfba4c1c302f0589c09a18ac553af9fa2c7e82109e12a1a89225dd06bb",
    "PocketTTS-GGUF/portuguese/embeddings/eponine.safetensors": "268bf106463dc70867a965a724af55c7d25c926d5408a6d962cb601c7bdac957",
    "PocketTTS-GGUF/portuguese/embeddings/estelle.safetensors": "8d6489742a5d4026f23f115f3430cafc4fe931fe9faa2df69e6c3cca5ba8e3c4",
    "PocketTTS-GGUF/portuguese/embeddings/eve.safetensors": "c3d3526bdf0d4f82a3e6cc8bca62148a20c69bbe6596fb72920478688f378488",
    "PocketTTS-GGUF/portuguese/embeddings/fantine.safetensors": "826b7131c94bb43ef9123780189e1f1ffac737c2bfec1c897e1244437b481d06",
    "PocketTTS-GGUF/portuguese/embeddings/george.safetensors": "f727f2820a343dc8cb0f867478e8feae9ecc8da41d6a84e6e051f1c192d20bb4",
    "PocketTTS-GGUF/portuguese/embeddings/jane.safetensors": "de8f3516290a8f554785366cd2ce5dac1ad6abf694b6d37a41553b092eeb508e",
    "PocketTTS-GGUF/portuguese/embeddings/javert.safetensors": "d4f340f52817471a7460530eddb77e8a6b4c06fea5bf285fb80dae46f1e73254",
    "PocketTTS-GGUF/portuguese/embeddings/marius.safetensors": "dda7f1265e424907c0260b8b640b4aaae6a2e926e7fa40ceda3ac270f316308f",
    "PocketTTS-GGUF/portuguese/embeddings/mary.safetensors": "7c7a02fa20d4581e36b54fef748d189873e2ce398ccc57376bf76a8466a6d9cb",
    "PocketTTS-GGUF/portuguese/embeddings/michael.safetensors": "d9348313f6e9d7badd420cffac11a59dc5767eeeccc7a679f8cfaaffecce7f2c",
    "PocketTTS-GGUF/portuguese/embeddings/paul.safetensors": "ce48b67d732704f38985b38f5d5dea54175fa5bca795379cad0cffd55e534668",
    "PocketTTS-GGUF/portuguese/embeddings/peter_yearsley.safetensors": "fad9560971b95008f09a58b9faf689c6e35dc6e1594d8a049c9ce9d65392a6cf",
    "PocketTTS-GGUF/portuguese/embeddings/stuart_bell.safetensors": "4e069c47b4a88d163847763efd654666de6c745f692d56d04a52a6b2e662bfa5",
    "PocketTTS-GGUF/portuguese/embeddings/vera.safetensors": "af141d1203871caef36d734d28b3aaee1acd2db00cf690fedcbc48d8268887de",
    // spanish
    "PocketTTS-GGUF/spanish/embeddings/alba.safetensors": "694be334ed6dda508b125e22a6ae480036d1c99923cccd92a643a348867f3235",
    "PocketTTS-GGUF/spanish/embeddings/anna.safetensors": "fe964cdad79e8c2c0d2ca30bc9dc8479c6f38b45b77512975a6e272109367337",
    "PocketTTS-GGUF/spanish/embeddings/azelma.safetensors": "7fe8e3e2bf5258c73c765f5553478b95386e760ccecbb46fe24c2632b5fd7458",
    "PocketTTS-GGUF/spanish/embeddings/bill_boerst.safetensors": "5b95f21e267bd88357fbb4fe3cba173d9e4ba39ade8f386bb004a293ab5b470f",
    "PocketTTS-GGUF/spanish/embeddings/caro_davy.safetensors": "d07fb793439eca0e2d650e5c8b49f21b829351ca76e9525f9ab39c136ceaf079",
    "PocketTTS-GGUF/spanish/embeddings/charles.safetensors": "d620942926b0a30dcf002212221c89bb4f3b8b9b9bd2cc7d034c5e1c792a675f",
    "PocketTTS-GGUF/spanish/embeddings/eponine.safetensors": "06e688d7b179125afc56009a0f9d263768daa2c9ac3a0c7d07d70e411c01d5a7",
    "PocketTTS-GGUF/spanish/embeddings/estelle.safetensors": "2342bd79d85e80da2f39a9cb4b4a5c3db4dec79cbbecfdf01c9af7e9578ea187",
    "PocketTTS-GGUF/spanish/embeddings/eve.safetensors": "3fdb6a2ddd06f339b015ec90aea2ea004c260fe463c9526e020249b307096a41",
    "PocketTTS-GGUF/spanish/embeddings/fantine.safetensors": "7941dd5a2666afc6db9dadfcd27ee0255df89b50227cbd9628a3c0f280ff6f91",
    "PocketTTS-GGUF/spanish/embeddings/george.safetensors": "da140d63300c46c31b49ec26402a0b4efed5d773da8310cf4ccca115853cdc87",
    "PocketTTS-GGUF/spanish/embeddings/jane.safetensors": "1bf9bfe3172412c44d0c7227e49eeb40b060f6833e2f6f365f0bbcde757afd09",
    "PocketTTS-GGUF/spanish/embeddings/javert.safetensors": "8a1d914ade79e8e470de3bd0725ad8bce62081976e352929d9d958a8773eba56",
    "PocketTTS-GGUF/spanish/embeddings/marius.safetensors": "56490a863e39b33fd1ab9c9e1fdaa87127f7b73cf73f259dc308c40015abb9f9",
    "PocketTTS-GGUF/spanish/embeddings/mary.safetensors": "9a2ccf97785a059592b3e56c6277ec1091b997e38452c69dd3f0e10ba1096603",
    "PocketTTS-GGUF/spanish/embeddings/michael.safetensors": "ca3dfdaff6a2bf70ef9b2ab69bc66dce6d16fb06d4d7473be92610d3e43e9e15",
    "PocketTTS-GGUF/spanish/embeddings/paul.safetensors": "fcd677f0459352f7cdf62d7a1424a663bd49fc8921fb2b8e346ef9b45c92dd04",
    "PocketTTS-GGUF/spanish/embeddings/peter_yearsley.safetensors": "088277ee6dbb17f00ac3519dd41c0c7dd5b977b4b946f173f6122f513d1921a7",
    "PocketTTS-GGUF/spanish/embeddings/stuart_bell.safetensors": "3182401767b42c6c6cf42c08047c939a903c9fb8895633e0b71bca65c6b476b0",
    "PocketTTS-GGUF/spanish/embeddings/vera.safetensors": "65787d133a1a55bc26ce50bb9cc0a992e8343b3ab006e27c2e755239512cd727",
  },
};

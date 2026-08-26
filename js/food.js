/* ============================================================
   food.js — the part of the Menu tab that understands food.

   Everything here is pure: text in, structured food out. No DOM, no
   storage, no network. That is deliberate — this same file is also
   `require`d by tools/build-recipes.js under Node, so a recipe scraped
   at build time and a recipe pasted in as a link at 6pm are parsed by
   exactly one parser. Two parsers would drift, and the moment they
   drift the fridge stops matching the recipes.

   What it does:
     parseIngredient()  "2 large boneless chicken breasts, diced"
                        -> {qty:2, unit:'ea', item:'chicken breast', ...}
     normalize()        the key both the fridge and the recipe agree on
     toGrams()          cups/tbsp/oz -> grams, per ingredient density
     macros()           kcal/protein/carbs/fat from a table of per-100g
                        values, when the recipe itself states none

   The nutrition table is a working set of common items, not a food
   database. Anything it does not know is reported as unknown rather
   than guessed at zero — a day that reads "1,400 kcal, 9 of 11
   ingredients counted" is honest; one that silently reads 1,400 is not.
   ============================================================ */

const Food = (() => {

  /* ---------- staples ----------
     Things a kitchen always has. They never reach the grocery list and
     never count against "how many ingredients am I missing", which is
     the whole point: a recipe needing salt, oil and chicken is one
     ingredient away, not three. */
  const STAPLES = new Set([
    'salt','sea salt','kosher salt','pepper','black pepper','white pepper',
    'water','ice','oil','olive oil','vegetable oil','canola oil','cooking spray',
    'sugar','brown sugar','flour','all-purpose flour','baking powder','baking soda',
    'cornstarch','vinegar','white vinegar','apple cider vinegar','vanilla extract',
    'garlic powder','onion powder','paprika','smoked paprika','cumin','chili powder',
    'oregano','basil','thyme','rosemary','bay leaf','cinnamon','nutmeg','ginger powder',
    'cayenne','red pepper flake','italian seasoning','curry powder','turmeric',
    'clove','cardamom','allspice','white pepper','msg','sesame seed','chili flake',
    'ground coriander','mustard powder','sesame oil','soy sauce','honey','ketchup',
    'mustard','mayonnaise','hot sauce','worcestershire sauce','stock','chicken stock',
    'beef stock','vegetable stock','yeast','cocoa powder','food colouring'
  ]);

  /* ---------- aliases ----------
     TheMealDB is British and the web is not, so half the corpus says
     "coriander" where the fridge will say "cilantro". Both sides run
     through this map, so they meet in the middle. */
  const ALIAS = {
    'coriander':'cilantro','fresh coriander':'cilantro','coriander leaf':'cilantro',
    'aubergine':'eggplant','courgette':'zucchini','rocket':'arugula',
    'spring onion':'green onion','scallion':'green onion',
    'capsicum':'bell pepper','red capsicum':'red bell pepper',
    'mince':'ground beef','beef mince':'ground beef','minced beef':'ground beef',
    'pork mince':'ground pork','lamb mince':'ground lamb','chicken mince':'ground chicken',
    'prawn':'shrimp','king prawn':'shrimp',
    'plain flour':'flour','self-raising flour':'flour','plain white flour':'flour',
    'caster sugar':'sugar','icing sugar':'powdered sugar','confectioner sugar':'powdered sugar',
    'double cream':'heavy cream','single cream':'cream','whipping cream':'heavy cream',
    'natural yogurt':'yogurt','greek yoghurt':'greek yogurt','yoghurt':'yogurt',
    'stock cube':'stock','beef stock cube':'beef stock','chicken stock cube':'chicken stock',
    'tomato puree':'tomato paste','passata':'tomato sauce','chopped tomato':'canned tomatoes',
    'tinned tomato':'canned tomatoes','plum tomato':'canned tomatoes',
    'canned tomato':'canned tomatoes','tinned tomatoes':'canned tomatoes',
    'chickpeas':'chickpea','garbanzo bean':'chickpea',
    'coriander powder':'ground coriander','cumin seed':'cumin',
    'chilli':'chili','chilli powder':'chili powder',
    'bicarbonate of soda':'baking soda','cornflour':'cornstarch',
    'streaky bacon':'bacon','back bacon':'bacon','rasher':'bacon',
    'beef fillet':'beef','sirloin steak':'steak','rump steak':'steak',
    'spaghetti':'pasta','penne':'pasta','fusilli':'pasta','macaroni':'pasta',
    'tagliatelle':'pasta','linguine':'pasta','rigatoni':'pasta','farfalle':'pasta',
    'unsalted butter':'butter','salted butter':'butter',
    'whole milk':'milk','semi skimmed milk':'milk','skimmed milk':'milk',
    'free range egg':'egg','egg yolks':'egg yolk','egg whites':'egg white',
    'extra virgin olive oil':'olive oil','sunflower oil':'vegetable oil',
    'rapeseed oil':'canola oil','groundnut oil':'peanut oil',
    'white onion':'onion','yellow onion':'onion','brown onion':'onion',
    'garlic clove':'garlic','clove of garlic':'garlic',
    'root ginger':'ginger','fresh ginger':'ginger',
    'cheddar cheese':'cheddar','parmigiano reggiano':'parmesan','parmesan cheese':'parmesan',
    'mozzarella cheese':'mozzarella','feta cheese':'feta',
    'baby spinach':'spinach','spinach leaf':'spinach',
    'sweetcorn':'corn','frozen pea':'pea','peas':'pea',
    'lemon juice':'lemon','lime juice':'lime','orange juice':'orange',
    'ground white pepper':'white pepper','ground pepper':'pepper','ground cinnamon':'cinnamon',
    'ground cumin':'cumin','ground ginger':'ginger powder','ground nutmeg':'nutmeg',
    'ground turmeric':'turmeric','ground paprika':'paprika','ground clove':'clove',
    'ground cardamom':'cardamom','ground allspice':'allspice','ground mustard':'mustard powder',
    'cooking oil':'oil','crushed red pepper':'red pepper flake',
    'red pepper flakes':'red pepper flake','crushed red pepper flakes':'red pepper flake',
    'chilli flakes':'chili flake','red chilli flakes':'chili flake',
    'cooking salt':'salt','table salt':'salt','fine salt':'salt','flaky salt':'sea salt',
    'flaked sea salt':'sea salt','ground black pepper':'black pepper',
    'freshly ground black pepper':'black pepper','cracked black pepper':'black pepper',
    'broth':'stock','chicken broth':'chicken stock','beef broth':'beef stock',
    'vegetable broth':'vegetable stock','bay leaves':'bay leaf','curry leaves':'curry leaf',
    'soy':'soy sauce','light soy sauce':'soy sauce','dark soy sauce':'soy sauce'
  };

  /* ---------- descriptors ----------
     Words that describe how a thing arrives rather than what it is.
     "finely chopped fresh flat-leaf parsley" and "parsley" are the same
     shopping trip. Stripped only from the ends, never the middle, so
     "ground beef" keeps its "ground" — there, it is the item. */
  const DESCRIPTORS = new Set([
    'fresh','freshly','finely','roughly','coarsely','thinly','thickly','chopped','minced',
    'diced','sliced','grated','shredded','crushed','peeled','seeded','deseeded','stemmed',
    'trimmed','rinsed','drained','cooked','uncooked','raw','thawed',
    'jarred','bottled','dried','packed','softened','melted','room','temperature',
    'large','medium','small','extra','ripe','unripe','boneless','skinless','skin-on',
    'bone-in','lean','organic','free','range','whole','halved','quartered','cubed','julienned',
    'good','quality','plus','more','optional','halves','to','taste','for','serving','garnish','divided',
    'about','approximately','heaped','level','rounded','warm','cold','hot','lukewarm','cut',
    'into','piece','pieces','strip','strips','wedge','wedges','ring','rings','torn','beaten',
    'washed','scrubbed','flat-leaf','sprig','sprigs','handful','pinch','dash','knob','bunch',
    'cracked','toasted','roasted','crumbled','pitted','sifted','zested','squeezed','store-bought',
    'homemade','plain','light','reduced','unsweetened','sweetened','firm','soft','thick','thin',
    'baby','wild','best','only','needed','if','desired','preferably','such','as','plus','uncooked',
    'see','note','notes','below','above','required','use','using','any','each','per','half','of',
    'dry','active','instant','granulated','coarse','fine','virgin','extra-virgin','pure','natural',
    'clove','cloves','stick','sticks','stalk','stalks','head','heads','can','cans','jar',
    'tin','packet','pack','box','the','a','an','and','or','your','some'
  ]);

  /* ---------- units ----------
     A number here means the unit converts to grams on its own. Volume
     units are null: a cup of flour and a cup of oil are not the same
     weight, so those resolve per ingredient in toGrams(). */
  const UNITS = {
    g:1, gram:1, grams:1, gr:1, kg:1000, kilogram:1000, kilograms:1000,
    oz:28.35, ounce:28.35, ounces:28.35, lb:453.6, lbs:453.6, pound:453.6, pounds:453.6,
    ml:1, milliliter:1, millilitre:1, milliliters:1, millilitres:1,
    l:1000, liter:1000, litre:1000, liters:1000, litres:1000,
    cup:null, cups:null, c:null,
    tbsp:null, tablespoon:null, tablespoons:null, tbs:null, tb:null,
    tsp:null, teaspoon:null, teaspoons:null, ts:null,
    pint:null, pints:null, quart:null, quarts:null, floz:null,
    ea:null, piece:null, pieces:null, slice:null, slices:null
  };

  /* Millilitres in one of each volume unit. */
  const ML = { cup:240, cups:240, c:240, tbsp:15, tablespoon:15, tablespoons:15, tbs:15,
               tb:15, tsp:5, teaspoon:5, teaspoons:5, ts:5, pint:473, pints:473,
               quart:946, quarts:946, floz:30 };

  /* ---------- nutrition ----------
     Per 100 g: kcal, protein, carbs, fat. `cup` is the weight of one cup
     and `ea` the weight of one of them — given only where the number
     means something (there is no useful "one flour"). Values are the
     USDA standard reference, rounded. */
  const N = (kcal,p,c,f,extra) => ({kcal,p,c,f,...extra});
  const FOODS = {
    /* proteins */
    'chicken breast':N(165,31,0,3.6,{ea:174}), 'chicken thigh':N(209,26,0,10.9,{ea:110}),
    'chicken':N(190,29,0,7.5), 'ground chicken':N(143,17,0,8),
    'turkey':N(189,29,0,7), 'ground turkey':N(150,19,0,8),
    'ground beef':N(254,17,0,20), 'beef':N(250,26,0,15), 'steak':N(271,25,0,19),
    'ground pork':N(263,17,0,21), 'pork':N(242,27,0,14), 'pork chop':N(231,26,0,13,{ea:150}),
    'bacon':N(541,37,1.4,42,{ea:12}), 'sausage':N(301,18,2,25,{ea:75}),
    'ham':N(145,21,1.5,6), 'ground lamb':N(282,17,0,23), 'lamb':N(258,25,0,17),
    'salmon':N(208,20,0,13,{ea:170}), 'tuna':N(132,28,0,1), 'cod':N(82,18,0,0.7,{ea:150}),
    'shrimp':N(99,24,0.2,0.3,{ea:7}), 'tilapia':N(96,20,0,1.7,{ea:120}),
    'egg':N(143,13,0.7,9.5,{ea:50}), 'egg white':N(52,11,0.7,0.2,{ea:33}),
    'egg yolk':N(322,16,3.6,27,{ea:17}),
    'tofu':N(76,8,1.9,4.8), 'tempeh':N(192,20,7.6,11),
    /* dairy */
    'milk':N(61,3.2,4.8,3.3,{cup:244}), 'butter':N(717,0.9,0.1,81,{cup:227}),
    'cheese':N(402,25,1.3,33,{cup:113}), 'cheddar':N(403,25,1.3,33,{cup:113}),
    'mozzarella':N(300,22,2.2,22,{cup:112}), 'parmesan':N(431,38,4.1,29,{cup:100}),
    'feta':N(264,14,4.1,21,{cup:150}), 'cream cheese':N(342,6,4.1,34,{cup:232}),
    'heavy cream':N(340,2.1,2.8,36,{cup:238}), 'cream':N(195,2.8,3.7,19,{cup:240}),
    'sour cream':N(198,2.4,4.6,19,{cup:230}), 'yogurt':N(59,10,3.6,0.4,{cup:245}),
    'greek yogurt':N(59,10,3.6,0.4,{cup:245}), 'ricotta':N(174,11,3,13,{cup:246}),
    /* vegetables */
    'onion':N(40,1.1,9.3,0.1,{ea:110,cup:160}), 'red onion':N(40,1.1,9.3,0.1,{ea:110}),
    'green onion':N(32,1.8,7.3,0.2,{ea:15}), 'shallot':N(72,2.5,17,0.1,{ea:30}),
    'garlic':N(149,6.4,33,0.5,{ea:3}), 'ginger':N(80,1.8,18,0.8),
    'carrot':N(41,0.9,10,0.2,{ea:61,cup:128}), 'celery':N(16,0.7,3,0.2,{ea:40,cup:101}),
    'potato':N(77,2,17,0.1,{ea:213,cup:150}), 'sweet potato':N(86,1.6,20,0.1,{ea:130}),
    'tomato':N(18,0.9,3.9,0.2,{ea:123,cup:180}), 'canned tomatoes':N(32,1.6,7,0.3,{cup:240}),
    'tomato paste':N(82,4.3,19,0.5,{cup:262}), 'tomato sauce':N(29,1.3,7,0.2,{cup:245}),
    'bell pepper':N(31,1,6,0.3,{ea:119,cup:149}), 'red bell pepper':N(31,1,6,0.3,{ea:119}),
    'chili':N(40,1.9,9,0.4,{ea:15}), 'jalapeno':N(29,0.9,6.5,0.4,{ea:14}),
    'mushroom':N(22,3.1,3.3,0.3,{ea:18,cup:70}), 'zucchini':N(17,1.2,3.1,0.3,{ea:196}),
    'eggplant':N(25,1,6,0.2,{ea:458}), 'broccoli':N(34,2.8,7,0.4,{cup:91,ea:600}),
    'cauliflower':N(25,1.9,5,0.3,{cup:107,ea:590}), 'cabbage':N(25,1.3,6,0.1,{cup:89}),
    'spinach':N(23,2.9,3.6,0.4,{cup:30}), 'kale':N(49,4.3,9,0.9,{cup:67}),
    'lettuce':N(15,1.4,2.9,0.2,{cup:36}), 'arugula':N(25,2.6,3.7,0.7,{cup:20}),
    'cucumber':N(15,0.7,3.6,0.1,{ea:301}), 'pea':N(81,5.4,14,0.4,{cup:145}),
    'corn':N(86,3.3,19,1.4,{cup:145,ea:90}), 'green bean':N(31,1.8,7,0.2,{cup:100}),
    'asparagus':N(20,2.2,3.9,0.1,{cup:134}), 'leek':N(61,1.5,14,0.3,{ea:89}),
    'butternut squash':N(45,1,12,0.1,{ea:900}), 'pumpkin':N(26,1,6.5,0.1,{cup:245}),
    'avocado':N(160,2,9,15,{ea:150}), 'olive':N(115,0.8,6,11,{cup:135}),
    'parsley':N(36,3,6,0.8,{cup:60}), 'cilantro':N(23,2.1,3.7,0.5,{cup:16}),
    'mint':N(70,3.8,15,0.9,{cup:32}), 'dill':N(43,3.5,7,1.1,{cup:9}),
    /* starch */
    'rice':N(365,7,80,0.7,{cup:185}), 'brown rice':N(370,7.9,77,2.9,{cup:190}),
    'pasta':N(371,13,75,1.5,{cup:100}), 'noodle':N(384,14,71,4,{cup:100}),
    'bread':N(265,9,49,3.2,{ea:30}), 'tortilla':N(310,8,52,7,{ea:45}),
    'flour':N(364,10,76,1,{cup:120}), 'oats':N(389,17,66,7,{cup:80}),
    'quinoa':N(368,14,64,6,{cup:170}), 'couscous':N(376,13,77,0.6,{cup:173}),
    'breadcrumbs':N(395,13,72,5.3,{cup:108}), 'lentil':N(352,25,63,1.1,{cup:192}),
    'chickpea':N(364,19,61,6,{cup:200}), 'black bean':N(341,21,62,1.4,{cup:194}),
    'kidney bean':N(333,24,60,0.8,{cup:184}), 'white bean':N(333,23,60,0.9,{cup:185}),
    /* fruit */
    'lemon':N(29,1.1,9,0.3,{ea:58}), 'lime':N(30,0.7,11,0.2,{ea:67}),
    'orange':N(47,0.9,12,0.1,{ea:131}), 'apple':N(52,0.3,14,0.2,{ea:182}),
    'banana':N(89,1.1,23,0.3,{ea:118}), 'strawberry':N(32,0.7,7.7,0.3,{cup:152}),
    'blueberry':N(57,0.7,14,0.3,{cup:148}), 'raspberry':N(52,1.2,12,0.7,{cup:123}),
    'pineapple':N(50,0.5,13,0.1,{cup:165}), 'mango':N(60,0.8,15,0.4,{ea:207}),
    'raisin':N(299,3.1,79,0.5,{cup:145}), 'date':N(282,2.5,75,0.4,{ea:24}),
    /* fats, nuts, extras */
    'olive oil':N(884,0,0,100,{cup:216}), 'vegetable oil':N(884,0,0,100,{cup:218}),
    'canola oil':N(884,0,0,100,{cup:218}), 'sesame oil':N(884,0,0,100,{cup:218}),
    'coconut oil':N(862,0,0,100,{cup:218}), 'coconut milk':N(230,2.3,5.5,24,{cup:240}),
    'peanut butter':N(588,25,20,50,{cup:258}), 'almond':N(579,21,22,50,{cup:143}),
    'walnut':N(654,15,14,65,{cup:117}), 'cashew':N(553,18,30,44,{cup:137}),
    'peanut':N(567,26,16,49,{cup:146}), 'sesame seed':N(573,18,23,50,{cup:144}),
    'sugar':N(387,0,100,0,{cup:200}), 'brown sugar':N(380,0,98,0,{cup:220}),
    'powdered sugar':N(389,0,99,0,{cup:120}), 'honey':N(304,0.3,82,0,{cup:340}),
    'maple syrup':N(260,0,67,0.1,{cup:322}), 'soy sauce':N(53,8,4.9,0.1,{cup:255}),
    'mayonnaise':N(680,1,0.6,75,{cup:220}), 'ketchup':N(101,1.2,26,0.1,{cup:240}),
    'mustard':N(66,4,5,3.3,{cup:249}), 'vinegar':N(21,0,0.9,0,{cup:239}),
    'chicken stock':N(4,0.7,0.4,0.1,{cup:240}), 'beef stock':N(4,0.7,0.4,0.1,{cup:240}),
    'vegetable stock':N(4,0.3,0.9,0,{cup:240}), 'stock':N(4,0.7,0.4,0.1,{cup:240}),
    'wine':N(83,0.1,2.6,0,{cup:235}), 'beer':N(43,0.5,3.6,0,{cup:240}),
    'chocolate':N(546,4.9,61,31,{cup:170}), 'cocoa powder':N(228,20,58,14,{cup:86}),
    'butter':N(717,0.9,0.1,81,{cup:227})
  };

  /* Which aisle a thing is found in — the grocery list is useless if it
     sends you back across the shop four times. */
  const AISLES = [
    ['Produce', /onion|garlic|ginger|carrot|celery|potato|tomato(?!es$)|pepper$|bell pepper|chili|jalapeno|mushroom|zucchini|eggplant|broccoli|cauliflower|cabbage|spinach|kale|lettuce|arugula|cucumber|pea$|corn|green bean|asparagus|leek|squash|pumpkin|avocado|lemon|lime|orange|apple|banana|berry|pineapple|mango|herb|parsley|cilantro|mint|dill|basil|thyme|rosemary|sage|scallion|shallot|lime|salad/i],
    ['Meat & fish', /chicken|beef|steak|pork|bacon|sausage|ham|lamb|turkey|salmon|tuna|cod|shrimp|prawn|tilapia|fish|mince|chop|fillet|brisket|ribs/i],
    ['Dairy & eggs', /milk|butter|cheese|cheddar|mozzarella|parmesan|feta|cream|yogurt|yoghurt|ricotta|egg/i],
    ['Bakery', /bread|tortilla|bun|roll|baguette|pita|naan|croissant|bagel/i],
    ['Frozen', /frozen|ice cream|puff pastry/i],
    ['Pantry', /flour|sugar|rice|pasta|noodle|oats|quinoa|couscous|lentil|chickpea|bean|oil|vinegar|sauce|paste|canned|tinned|stock|broth|honey|syrup|nut|almond|walnut|cashew|peanut|seed|spice|powder|dried|breadcrumb|chocolate|cocoa|coconut/i]
  ];

  function aisleFor(key){
    for(const [name, re] of AISLES) if(re.test(key)) return name;
    return 'Other';
  }

  /* Unicode fractions, because recipe sites are full of them. */
  const VULGAR = {'½':0.5,'⅓':1/3,'⅔':2/3,'¼':0.25,'¾':0.75,
                  '⅕':0.2,'⅖':0.4,'⅗':0.6,'⅘':0.8,'⅙':1/6,
                  '⅚':5/6,'⅛':0.125,'⅜':0.375,'⅝':0.625,'⅞':0.875};

  function singular(w){
    if(w.length < 4) return w;
    if(/(ss|us|is)$/.test(w)) return w;
    if(/ies$/.test(w)) return w.slice(0,-3) + 'y';
    if(/oes$/.test(w)) return w.slice(0,-2);
    if(/ves$/.test(w)) return w.slice(0,-3) + 'f';
    if(/(ches|shes|xes|zes|ses)$/.test(w)) return w.slice(0,-2);
    if(/s$/.test(w)) return w.slice(0,-1);
    return w;
  }

  /* The one key the fridge and every recipe agree on. The alias map runs
     more than once — before stripping and after — so both "chopped fresh
     coriander" and "coriander" land on cilantro. */
  function normalize(raw){
    let s = String(raw || '').toLowerCase().trim();
    s = s.replace(/\([^)]*\)/g,' ')
         .replace(/[^a-z0-9\s-]/g,' ')
         .replace(/\s+/g,' ').trim();
    if(ALIAS[s]) return ALIAS[s];

    let words = s.split(' ').filter(Boolean);
    const junk = w => DESCRIPTORS.has(w) || /^[\d.]+$/.test(w);
    while(words.length > 1 && junk(words[0])) words.shift();
    while(words.length > 1 && junk(words[words.length - 1])) words.pop();
    if(!words.length) return '';

    words[words.length - 1] = singular(words[words.length - 1]);
    let out = words.join(' ');
    if(ALIAS[out]) out = ALIAS[out];
    /* "parsley leaf", "spinach leaf", "basil leaf" — a herb's leaves are
       the herb. Only when the stem is something we actually know, so
       "bay leaf" is left alone. */
    if(!FOODS[out] && !STAPLES.has(out) && / leaf$/.test(out)){
      const stem = out.replace(/ leaf$/,'');
      if(ALIAS[stem]) out = ALIAS[stem];
      else if(FOODS[stem] || STAPLES.has(stem)) out = stem;
    }
    /* Long tails rarely match whole; the last two words usually do —
       "organic italian roma tomato" is a tomato. */
    if(!FOODS[out] && words.length > 2){
      const tail = words.slice(-2).join(' ');
      if(ALIAS[tail]) return ALIAS[tail];
      if(FOODS[tail]) return tail;
      const last = words[words.length - 1];
      if(ALIAS[last]) return ALIAS[last];
      if(FOODS[last]) return last;
    }
    return out;
  }

  function isStaple(key){ return STAPLES.has(key); }

  /* What to put on a shopping list. The parsed `item` keeps whatever
     punctuation the source used — asterisks pointing at a footnote, a
     stray bracket from a nested aside — and none of that belongs on a
     line you read in a supermarket. Falls back to the normalised key,
     which is always clean. */
  function pretty(item, key){
    const words = String(item || '')
      .replace(/[^a-zA-Z0-9\s-]/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
    /* Numbers stranded at either end are the wreckage of a price or a
       gram equivalent, not part of the name. */
    while(words.length && /^[\d.-]+$/.test(words[0])) words.shift();
    while(words.length && /^[\d.-]+$/.test(words[words.length - 1])) words.pop();
    const s = words.join(' ');
    return s.length > 1 ? s : (key || '');
  }

  /* "1 1/2 cups (350ml) whole milk, warmed" ->
     {qty:1.5, unit:'cup', item:'whole milk', key:'milk', note:'warmed'} */
  function parseIngredient(raw){
    const original = String(raw || '').trim();
    if(!original) return null;

    let s = original.toLowerCase();
    const optional = /\boptional\b|\bto taste\b|\bfor garnish\b/.test(s);

    /* Parentheticals go first, before the comma split — recipe sites put
       gram equivalents and even per-item prices in them, and half of
       those asides contain a comma of their own. Splitting first leaves
       a dangling "(about one bunch" as the ingredient name. */
    s = s.replace(/https?:\/\/\S+/g, ' ');
    s = s.replace(/[$£€]\s*[\d.,]+\**/g, ' ');
    for(let i = 0; i < 3 && s.includes('('); i++) s = s.replace(/\([^()]*\)/g, ' ');
    s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

    /* Anything after a comma or a dash is preparation, not identity:
       "chicken thighs, boneless" and "plain yogurt - see note" both
       carry their real name in front of the break. */
    let note = '';
    const brk = s.search(/,|\s[-–—]\s/);
    if(brk > 0){ note = s.slice(brk + 1).trim(); s = s.slice(0, brk); }


    s = s.replace(/[¼-¾⅐-⅞]/g, m => ' ' + (VULGAR[m] ?? '') + ' ')
         .replace(/\s+/g,' ').trim();

    let qty = null;
    const m = s.match(/^([\d.]+)\s*(?:[-–]|to)\s*([\d.]+)|^(\d+)\s+(\d+)\s*\/\s*(\d+)|^(\d+)\s*\/\s*(\d+)|^([\d.]+)/);
    if(m){
      if(m[1] !== undefined)      qty = (parseFloat(m[1]) + parseFloat(m[2])) / 2;   // a range: take the middle
      else if(m[3] !== undefined) qty = parseFloat(m[3]) + parseFloat(m[4]) / parseFloat(m[5]);
      else if(m[6] !== undefined) qty = parseFloat(m[6]) / parseFloat(m[7]);
      else                        qty = parseFloat(m[8]);
      s = s.slice(m[0].length).trim();
      /* A fraction left behind by the vulgar expansion: "1 0.5 cups". */
      const m2 = s.match(/^(0?\.\d+)\s+/);
      if(m2){ qty += parseFloat(m2[1]); s = s.slice(m2[0].length).trim(); }
    }

    let unit = null;
    const um = s.match(/^([a-z]+\.?)\s+/);
    if(um){
      const u = um[1].replace(/\.$/,'');
      if(Object.prototype.hasOwnProperty.call(UNITS, u)){ unit = u; s = s.slice(um[0].length).trim(); }
    }
    /* "1 (14 oz) can tomatoes" — the can size is an aside, the count is 1. */
    s = s.replace(/^\(([^)]*)\)\s*/, '').replace(/^of\s+/,'').trim();

    /* Australian and British sites write both systems: "500 g / 1 lb
       chicken mince". The metric half has already been taken as the
       quantity, so the imperial twin is noise. */
    s = s.replace(/^\/\s*[\d./\s]+\s*(?:g|kg|ml|l|oz|lb|lbs|cup|cups|tsp|tbsp)\b\.?/, '').trim();

    /* "dry active yeast or instant yeast", "cooking salt / kosher salt",
       "salt and pepper" — one line, one thing to shop for. Take the part
       before the first join word: it is the one the author meant. This
       costs us "macaroni and cheese" as an ingredient line, a fair trade
       for not putting "salt and pepper" on a grocery list as though it
       were a single unbuyable product. */
    const alt = s.search(/\bor\b|\band\b|\s\/\s|(?<=[a-z])\/(?=[a-z])/);
    if(alt > 2) s = s.slice(0, alt).trim();

    const item = s.replace(/\s+/g,' ').trim();
    const key  = normalize(item);
    return {
      raw: original, qty, unit: unit || (qty != null ? 'ea' : null),
      item, key, note, optional, staple: STAPLES.has(key)
    };
  }

  /* Grams, or null when the honest answer is "no idea". Volume resolves
     through the ingredient's own cup weight: a cup of oil is 216 g and a
     cup of spinach is 30, and averaging those is worse than saying
     nothing at all. */
  function toGrams(qty, unit, key){
    if(qty == null) return null;
    const f = FOODS[key];
    if(unit && UNITS[unit]) return qty * UNITS[unit];
    if(unit && ML[unit]){
      const perCup = f && f.cup ? f.cup : null;
      if(perCup) return qty * (ML[unit] / 240) * perCup;
      return qty * ML[unit];                       // fall back to water
    }
    if(f && f.ea && (!unit || ['ea','piece','pieces','slice','slices'].includes(unit)))
      return qty * f.ea;
    return null;
  }

  function nutritionFor(key){ return FOODS[key] || null; }

  /* Whole-recipe macros, per serving. Reports what it knew and what it
     did not, so the UI can say so rather than pretend. */
  function macros(ingredients, servings){
    let kcal = 0, p = 0, c = 0, f = 0, known = 0, total = 0;
    const missing = [];
    for(const ing of (ingredients || [])){
      if(!ing || ing.staple) continue;             // a teaspoon of salt is not dinner
      total++;
      const n = FOODS[ing.key];
      const g = toGrams(ing.qty, ing.unit, ing.key);
      if(!n || g == null){ missing.push(ing.item || ing.key); continue; }
      const mult = g / 100;
      kcal += n.kcal * mult; p += n.p * mult; c += n.c * mult; f += n.f * mult;
      known++;
    }
    const per = Math.max(1, servings || 1);
    return {
      kcal: Math.round(kcal / per), protein: Math.round(p / per),
      carbs: Math.round(c / per),   fat: Math.round(f / per),
      known, total, missing,
      confident: total > 0 && known / total >= 0.7
    };
  }

  /* An ISO 8601 duration ("PT1H25M") — what every recipe site's
     structured data uses — into plain minutes. */
  function isoMinutes(iso){
    if(typeof iso === 'number') return iso || null;
    const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
    if(!m) return null;
    return ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0)) || null;
  }

  return { STAPLES, FOODS, ALIAS, UNITS, normalize, singular, isStaple, aisleFor, pretty,
           parseIngredient, toGrams, nutritionFor, macros, isoMinutes };
})();

/* Works in both worlds: a <script> tag in the browser, a require() in
   tools/build-recipes.js. */
if(typeof module !== 'undefined' && module.exports) module.exports = Food;
if(typeof window !== 'undefined') window.Food = Food;

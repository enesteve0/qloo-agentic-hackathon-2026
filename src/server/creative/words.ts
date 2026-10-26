import 'server-only';

/**
 * Word lists for the grounding validator. All entries are lower-case, diacritic-free single words
 * (contractions without apostrophes, e.g. "dont"); plurals are matched through `singular()`.
 */

function list(...chunks: string[]): Set<string> {
  return new Set(chunks.join(' ').split(/\s+/).filter(Boolean));
}

/**
 * Proper adjectives used for cuisines and styles (not targeting; see SENSITIVE_TERMS for people).
 * Templates keep them capitalized when they lower-case other evidence labels.
 */
export const PROPER_ADJECTIVES = list(
  `american italian mexican chinese japanese korean thai vietnamese indian french spanish greek
  turkish lebanese mediterranean caribbean jamaican haitian dominican cuban peruvian colombian
  ecuadorian brazilian argentinian argentine venezuelan salvadoran ethiopian nigerian ghanaian
  senegalese moroccan egyptian israeli persian georgian russian ukrainian polish german irish british
  english scottish dutch belgian swiss portuguese filipino malaysian indonesian taiwanese cantonese
  sichuan szechuan hunan uyghur tibetan nepali bangladeshi pakistani afghan uzbek neapolitan
  sicilian roman tuscan parisian southern northern cajun creole hawaiian texan asian african european
  arabic nordic scandinavian tex mex`,
);

/**
 * Words that are fine capitalized mid-sentence (Title Case headlines are common in ads). Anything
 * capitalized mid-sentence that is not here, not in the brief, the business name, the neighborhood
 * or the evidence labels is treated as an unverified name. Never add place names: those belong in
 * the lexicon, where the foreign-neighborhood rule can see them.
 */
export const COMMON_WORDS = list(
  // function words, pronouns, contractions (apostrophes removed by tokenization)
  `a about above across after again against ahead all almost along already also always am among an and
  another any anyone anything anytime anyway are around as at away back be because been before behind
  being below beside besides best better between beyond big both but by can cannot could did do does
  doing done down during each either else enough even ever every everybody everyone everything
  everywhere few for from further get gets getting give gives go goes going gone good got great had has
  have having he her here hers herself him his how however i if in inside instead into is it its itself
  just keep keeps kind lets like little lot lots many may maybe me might mine more most much must my
  myself near nearly neither never next no nobody none nor not nothing now of off often oh ok okay on
  once one ones only onto or other others our ours ourselves out outside over own per perhaps please
  plus quite rather really same she should since so some somebody someone something sometimes
  somewhere soon still such than that the their theirs them themselves then there these they thing
  things this those though through throughout till to too toward towards under until up upon us very
  via was way ways we well were what whatever when whenever where wherever whether which while who
  whoever whole whom whose why will with within without would yes yet you your yours yourself
  yourselves dont doesnt didnt isnt arent wasnt werent wont cant couldnt shouldnt wouldnt youre youll
  youve weve theyre theres heres whats thats im ive id ill hey hi hello welcome cheers thanks thank`,
  // numbers and quantities written as words
  `zero two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred
  thousand first second third fourth fifth last final half double triple single dozen pair couple
  several plenty extra`,
  // verbs common in ads
  `add ask bake beat bite book booked booking bring brings brew browse build buy call came catch
  celebrate celebrating change chill choose claim close closing come comes coming cook cop cooking
  create cross dance danced dancing deliver delivered discover draw drawn drink drinking drop dropping
  earn eat eating enjoy enter explore feel feels find follow found gather grab grow hang hear help
  hit hold host hosted hosting join keep know laugh learn leave let listen live loved love loves
  make made makes meet meets miss mix order pack paint pair pass pick play played playing pour pours
  pull push raise reach read redeem relax remember reserve rest return ride rise rock roll run save
  say scan see seen sell serve served serves serving share shop show sing sip sit skip sleep slide
  smile sold spend spin start stay step stop stream stroll swing take taste tasting tell thank try
  turn unlock unwind visit vote wait walk wander want warm watch wear win wind wish work write`,
  // adjectives and adverbs
  `able alive amazing authentic awesome back bad beautiful better big bigger biggest bold bright brand
  brilliant busy calm casual cheap classic clean clever close cold cool cozy cosy crisp curated daily
  dark dear deep delicious different easy electric elegant epic essential exclusive famous fancy fast
  favorite favourite festive fine finest fresh friendly full fun funky funny gentle genuine giant glad
  golden good gorgeous grand great handmade happy hearty heavy high homemade honest hot huge iconic
  ideal incredible independent intimate just kind large late latest lazy legendary light limited
  little live lively local long loud lovely low loyal lucky lush main major many mellow mighty modern
  more new newest next nice nightly no nonstop open original perfect plain pleasant popular premium
  pretty proper proud pure quick quiet rare raw ready real rich right rowdy royal rustic sacred safe
  seasonal secret serious sharp short signature simple slow small smart smooth soft solid soulful
  special spicy splendid steady sticky still strong stylish sunny super sweet tasty tender tiny top
  total tough tropical true ultimate unique upbeat urban usual vibrant vintage warm weekly welcoming
  whole wild wonderful worth young yummy really truly simply finally freshly always early just about
  ever forever often soon tonight together`,
  // time
  `time times today tomorrow tonight yesterday morning mornings afternoon evening night nights midnight
  noon day days daytime nighttime week weeks weekend weekends weekday weekdays weeknight weeknights
  month months year years hour hours minute minutes moment moments season seasons date dates early
  late now then anniversary birthday`,
  // places and the street, generic (never specific neighborhood names)
  `block blocks corner corners street streets avenue ave st blvd road lane sidewalk stoop stoops
  neighborhood neighbourhood neighborhoods hood borough boroughs city town uptown downtown crosstown
  north south east west upper lower central center centre outer inner side home house place places
  spot spots room rooms floor door doors window windows table tables seat seats bar bars counter
  kitchen garden gardens yard backyard rooftop roof patio terrace porch park parks square plaza
  market markets station train trains subway ferry bus line lines stop bridge bridges river harbor
  harbour beach bay hill hills heights village point island islands water waterfront shore coast
  world earth sun moon star stars sky local locals`,
  // people and community (non-demographic)
  `neighbor neighbors neighbour neighbours friend friends family families folks people everyone
  crowd crew team guests guest regulars members member community fans host hosts chef chefs cook
  cooks owner owners maker makers artist artists musician musicians dancer dancers band bands
  barista bartender bartenders staff kids partner partners couple couples date mother father mothers
  fathers mom dad moms dads`,
  // food and drink
  `food foods eats eat bite bites snack snacks meal meals menu menus dish dishes plate plates platter
  breakfast brunch lunch dinner supper dessert desserts appetizer appetizers sides tasting omakase
  pizza pizzas slice slices pie pies calzone pasta noodle noodles ramen udon soba pho dumpling
  dumplings bao bun buns taco tacos burrito burritos quesadilla nachos arepa arepas empanada
  empanadas pupusa pupusas tamale tamales patty patties jerk oxtail roti curry biryani kebab kebabs
  shawarma falafel hummus gyro gyros pierogi borscht bagel bagels lox schmear knish pastrami deli
  sandwich sandwiches hero heroes sub burger burgers fries wings chicken fried fry steak steaks beef
  pork lamb ribs brisket barbecue bbq smoked smoky smoke grill grilled roast roasted seafood fish
  oyster oysters clam clams crab lobster shrimp sushi sashimi poke salad salads soup soups stew
  vegan vegetarian veggie plant based gluten free halal kosher organic farm harvest market spice
  spices spicy sweet savory salty sour bitter fresh hot iced cold cake cakes cupcake cupcakes cookie
  cookies donut donuts doughnut doughnuts croissant croissants pastry pastries bread breads
  sourdough bakery bakeries bakeshop dough butter cheese cream ice gelato sorbet chocolate candy
  sugar honey vanilla caramel cinnamon coffee coffees espresso latte lattes cappuccino cortado brew
  roast roastery tea teas matcha chai boba juice juices smoothie smoothies soda water wine wines
  natural orange beer beers ale lager ipa cider sake soju mezcal tequila whiskey whisky bourbon rye
  rum gin vodka spirits spirit cocktail cocktails mocktail mocktails drink drinks sips shot shots
  pint pints glass bottle bottles taps tap draft draught round rounds happy hour hours tapas mezze
  waffle waffles pancake pancakes eggs egg bacon toast grits greens rice beans potatoes cornbread
  peach peaches apple apples cherry berry berries lemon lime mango coconut plantain plantains`,
  // venues, retail and services
  `cafe cafes coffeehouse diner diners bistro brasserie trattoria pizzeria taqueria cantina izakaya
  restaurant restaurants eatery tavern pub pubs lounge lounges club clubs speakeasy venue venues
  stage stages hall halls theater theatre theaters cinema cinemas gallery galleries museum museums
  studio studios shop shops store stores boutique boutiques bodega market showroom salon barbershop
  barber spa gym studio bookstore bookshop library records record vinyl thrift vintage market flea
  popup pop up pickup takeout delivery catering reservation reservations walk ins`,
  // music, arts, events and culture
  `music musical song songs sound sounds track tracks beat beats groove grooves rhythm tune tunes
  album albums single singles mixtape playlist set sets show shows gig gigs concert concerts tour
  residency session sessions jam jams open mic karaoke dj djs mc mcs band trio quartet quintet
  ensemble orchestra choir horn horns piano keys bass drum drums sax saxophone trumpet guitar strings
  vocals voice voices singer singers jazz blues soul funk gospel hip hop rap rnb r b reggae
  reggaeton salsa bachata merengue cumbia afrobeat afrobeats amapiano dancehall soca calypso house
  techno disco electronic indie rock punk metal folk country bluegrass classical opera latin pop swing
  bebop bossa nova samba tango flamenco cabaret burlesque drag comedy comic comics standup stand
  improv sketch poetry spoken word reading readings book books story stories film films movie movies
  screening screenings premiere matinee art arts painting paintings drawing drawings print prints
  poster posters mural murals animation animated cartoon cartoons illustration exhibit exhibition
  exhibitions collection collections craft crafts design designs fashion style styles streetwear
  sneaker sneakers apparel merch drop drops release releases collab collabs edition editions launch
  debut opening reopening party parties festival fest fair event events night nights lineup ticket
  tickets presale entry admission cover pass passes rsvp vip guestlist trivia bingo games game
  arcade dance dancing dancefloor floor stage scene culture vibe vibes energy mood flavor flavors
  flavour flavours taste tastes love joy heart soul spirit magic`,
  // offers and calls to action
  `deal deals offer offers special specials discount discounts sale sales price prices free gift
  gifts card cards code codes promo bonus reward rewards points loyalty membership members save
  savings off half price percent each per only today now tonight limited while supplies last call
  order book reserve visit join follow scan`,
  // colours and materials
  `black white red blue green gold golden silver pink purple orange yellow brown gray grey neon
  wood brick velvet glass steel copper`,
  // proper adjectives used for cuisines and styles (kept capitalized in template copy)
  [...PROPER_ADJECTIVES].join(' '),
  // acronyms and abbreviations that are not names
  `nyc ny bk dj mc bbq ipa byob rsvp vip tv am pm ok diy hq usa us lp lps ep cd qr atm asap aka pr
  bff hd ev est co`,
  // more Title Case ad vocabulary: dishes, drinks, venues, events, verbs and moods
  `sunset sunrise dusk dawn twilight fire flame salt pepper garlic herb herbs hand crafted
  handcrafted brewed baked poured rolled stuffed loaded melted toasted fired cooked aged owned run
  established hometown homegrown neighborly online dine dining batch prix fixe bottomless mimosa
  margarita sangria spritz negroni martini mojito daiquiri bellini paloma highball fashioned sazerac
  cosmo tiki jollof suya injera dim sum bibimbap kimchi bulgogi banh mi ceviche mole birria elote
  churro churros tostones mofongo pernil pollo arroz rotisserie gnocchi risotto lasagna cannoli
  tiramisu focaccia panini baguette crepe crepes macaron macarons baklava rugelach babka challah
  latke latkes bialy pickle pickles mac collard collards gumbo jambalaya dog dogs pretzel pretzels
  shake shakes malt sundae froyo cobbler pudding brownie brownies muffin muffins scone scones biscuit
  biscuits gravy hash benedict omelette avocado granola acai bowl bowls wrap wraps grain grains kale
  tofu tempeh seitan pita naan tikka masala samosa samosas dosa thali momo momos pad satay adobo
  lumpia halo bubble kombucha nitro oat milk almond turntable turntables system outdoor indoor air
  afterparty nightcap owl owls bird birds listening baking brewing shopping singing jamming living
  gathering meeting happening selling pouring spinning swinging rocking rolling laughing experience
  experiences adventure journey escape ritual tradition traditions recipe recipes staple staples
  basics goods gear kicks fits threads piece pieces capsule archive restock raffle queue showtime
  curtain encore headliner opener series volume chapter episode works canvas frame frames cel ink
  color colour colors colours paper pencil zine zines workshop workshops class classes lesson
  lessons talk talks panel sample samples stock joke jokes punchline showcase hilarious life lives
  memory memories feeling feelings wonder dream dreams hope peace unity pride power luck chance
  hidden gem gems treasure treasures discovery goodbye bye yo ya yall psst wow yum nope hungry
  thirsty tired joint haunt hangout hideaway den nook parlor parlour loft basement cellar garage
  warehouse courtyard deck link treat indulge savor savour feast connect mingle recharge refuel fuel
  through`,
);

/** Weekdays, months, seasons and holidays, with common abbreviations. */
export const CALENDAR_WORDS = list(
  `monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat
  sun january february march april may june july august september october november december jan feb
  mar apr jun jul aug sep sept oct nov dec spring summer fall autumn winter holiday holidays
  halloween thanksgiving christmas xmas eve hanukkah chanukah kwanzaa diwali eid ramadan easter
  passover juneteenth valentine valentines nye new year lunar cyber labor memorial veterans
  independence super bowl marathon`,
);

export function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word) || CALENDAR_WORDS.has(word);
}

export type SensitiveCategory =
  | 'age'
  | 'race or ethnicity'
  | 'religion'
  | 'health'
  | 'sexuality or gender identity'
  | 'gender'
  | 'politics'
  | 'income'
  | 'immigration status';

/**
 * Targeting and demographic terms (PRODUCT §5 and §10). Patterns run on normalized copy: lower
 * case, diacritics removed, punctuation turned into single spaces ("Gen-Z" → "gen z",
 * "LGBTQ+" → "lgbtq"). Group adjectives such as "black", "latin", "jewish" or "italian" are only
 * flagged when they describe people ("Black-owned", "Latino families"), never food, music or
 * colour ("black coffee", "Latin jazz", "Jewish deli", "Italian family recipes", "egg whites").
 */
const GROUP_ADJ = `(?:black|white|brown|asian|latino|latina|latinx|latine|latin|hispanic|caucasian|african american|afro latino|afro caribbean|caribbean|west indian|indigenous|native american|arab|middle eastern|south asian|east asian|desi|chinese|korean|japanese|filipino|vietnamese|indian|pakistani|bangladeshi|mexican|dominican|puerto rican|haitian|jamaican|trinidadian|guyanese|cuban|colombian|ecuadorian|salvadoran|venezuelan|brazilian|russian|ukrainian|polish|italian|irish|greek|jewish|muslim|christian|catholic|hindu|sikh|buddhist|orthodox|hasidic|immigrant|ethnic|minority|gay|lesbian|queer|trans|transgender)`;
const PEOPLE = `(?:community|communities|people|persons|folks|families|residents|neighbors|neighbours|crowd|crowds|audience|audiences|customers|consumers|shoppers|men|women|guys|gals|girls|boys|youth|kids|children|population|populations|households|professionals|singles|couples|voters|demographic|demographics|enclave|enclaves|owned|led|majority)`;

export const SENSITIVE_TERMS: readonly { pattern: RegExp; category: SensitiveCategory }[] = [
  {
    category: 'age',
    pattern:
      /\b(?:seniors|senior citizens?|senior discounts?|elderly|retirees|pensioners|baby boomers?|boomers?|millennials?|zoomers?|gen ?(?:x|y|z|alpha)(?:ers)?|generation (?:x|y|z|alpha)|teens|teenagers?|tweens|young professionals?|yuppies|middle aged|old people|older adults|young people|over (?:thirty|forty|fifty|sixty|seventy)s?)\b/,
  },
  { category: 'race or ethnicity', pattern: new RegExp(`\\b${GROUP_ADJ} ${PEOPLE}\\b`) },
  {
    category: 'race or ethnicity',
    pattern:
      /\b(?:latinos|latinas|latinx|latine|hispanics|asians|caucasians|africans|african americans|arabs|desis|minorities|ethnicity|ethnicities|racial|racially|people of color|poc|bipoc|mexicans|dominicans|puerto ricans|haitians|jamaicans|trinidadians|cubans|colombians|ecuadorians|salvadorans|venezuelans|brazilians|russians|ukrainians|italians|koreans|filipinos|pakistanis|bangladeshis|nigerians|ghanaians|indians)\b/,
  },
  {
    category: 'religion',
    pattern: /\b(?:muslims?|jews|christians|catholics|hindus|sikhs|buddhists|mormons|evangelicals|atheists|hasidim|churchgoers|worshippers)\b/,
  },
  {
    category: 'health',
    pattern:
      /\b(?:diabetic|diabetics|diabetes|cancer|hiv|depression|depressed|anxiety|adhd|autism|autistic|dementia|alzheimers?|arthritis|asthma|asthmatic|obese|obesity|overweight|weight loss|lose weight|addiction|addicts|mental health|mental illness|mentally ill|disabled|disability|disabilities|handicapped|wheelchair users|pregnant|pregnancy|infertility|menopause|chronic pain|chronic illness|stds?|stis?|cholesterol|blood pressure|hypertension|insomnia)\b/,
  },
  {
    category: 'sexuality or gender identity',
    pattern:
      /\b(?:gay|gays|lesbians?|bisexuals?|queer|\w*lgbt\w*|homosexuals?|heterosexuals?|transgender|non ?binary|sexual orientation|gender identity|trans (?:people|women|men|folks|community|youth))\b/,
  },
  { category: 'gender', pattern: /\b(?:ladies night|ladies only|women only|men only|girls only|boys only|gentlemen only)\b/ },
  {
    category: 'politics',
    pattern:
      /\b(?:democrats?|republicans?|gop|maga|liberals|conservatives|leftists?|right wing|left wing|socialists?|communists?|progressives|voters?|elections?|ballots?|political|politics|partisan|pro life|pro choice|abortion)\b/,
  },
  {
    category: 'income',
    pattern:
      /\b(?:low income|high income|affluent|wealthy|rich people|poor people|working class|upper class|middle class|blue collar|white collar|welfare|food stamps|millionaires|billionaires|high net worth)\b/,
  },
  {
    category: 'immigration status',
    pattern: /\b(?:immigrants?|migrants?|refugees?|asylum seekers?|undocumented|illegal aliens?|green card holders?|foreigners)\b/,
  },
];

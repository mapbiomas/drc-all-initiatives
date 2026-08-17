/**
 * ============================================================================
 * DRC REGIONAL INTEGRATION
 * MIOMBO–MOSAIC RF TRANSITION WITH TEMPORALLY STABLE PIXELS
 * AND STOCHASTIC DECISION FEATHERING
 * ============================================================================
 *
 * SCRIPT OVERVIEW
 * ---------------
 * This script processes and integrates regional land-cover classification maps 
 * for the Democratic Republic of Congo (DRC). Its primary objective is to 
 * eliminate artificial thematic discontinuities (hard boundary lines) between 
 * the independently classified Miombo and Mosaic regions.
 * 
 * To achieve a seamless ecological transition, the script trains a localized 
 * Random Forest (RF) classifier on temporally stable pixels, generates a 
 * transitional map, and blends it into the national map using distance-weighted 
 * local prevalence, spatial dithering, and class-specific edge protection.
 *
 * HIGH-LEVEL WORKFLOW
 * -------------------
 * 1. Asset Loading & Setup: Imports regional classifications, geometries, and Landsat.
 * 2. Transition Corridor Definition: Generates a buffer where Miombo and Mosaic intersect.
 * 3. Temporally Stable Pixel Extraction: Identifies unchanged pixels (2000-2025).
 * 4. Proportional Sampling: Allocates training budgets based on class area proportions.
 * 5. Random Forest Classification: Trains an annual RF model to propose an ecotone.
 * 6. Stochastic Decision Feathering: Blends maps using local prevalence and random noise.
 * 7. Export Execution: Exports a single multi-band final map to assets.
 * 
 * ============================================================================
 */

// ------------------------------ CONFIGURATION -------------------------------

var countryName = 'DRC';

var years = [
  2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009,
  2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019,
  2020, 2021, 2022, 2023, 2024, 2025
];

// Execution Modes: 
// If runInspection = true, it processes inspectionYear and renders to the map.
// If createAnnualExportTasks = true, it suppresses map rendering and generates batch tasks.
var inspectionYear = 2025;
var runInspection = true;
var createAnnualExportTasks = false;
var createStableMapExportTasks = true;

var classificationScale = 30;
var stableSampleScale = 90;

// corridorHalfWidthMeters: The half-width (60km) of the transition zone.
var corridorHalfWidthMeters = 60000;
var contactToleranceMeters = 300;
var trainingExclusionMeters = 3000;
var trainingBeltWidthMeters = 150000;
var geometryError = ee.ErrorMargin(100);

// featherWidthMeters: The distance (30km) over which the original map 
// gradually loses influence and the RF prediction gains influence.
var featherWidthMeters = 30000; 

// prevalenceRadiusMeters: Radius used to calculate local spatial prevalence 
// of transition classes (3, 4, 66) to determine replacement viability.
var prevalenceRadiusMeters = 2000;
var minimumPrevalenceGain = 0.03;

// edgePreservationPenalty: A baseline mathematical penalty applied to the 
// required support gain near edges to protect the original regional maps.
var edgePreservationPenalty = 0.20; 

// class4ProtectionPenalty: An extreme penalty added to the decision threshold 
// ONLY if the original pixel was Class 4. This restricts Class 66 (or others) 
// from overwriting Class 4 near the Miombo boundaries.
var class4ProtectionPenalty = 0;

// spatialDitherMagnitude: The maximum amplitude of random noise injected 
// into the decision threshold to break up contour lines into natural patches.
var spatialDitherMagnitude = 0.15;

var rfPredictionBonus = 0.04; 
var originalClassTieBreak = 0.000001;

var classDecisionFactors = ee.Dictionary({
  '3': 3,
  '4': 1.0,
  '66': 0.8
});

var transitionClasses = [3, 4, 66];

// totalAnnualSamples: Base sample budget for the RF model.
var totalAnnualSamples = 3000;

// classSampleFactors: Reduces sampling weight. (e.g., Class 4 reduced by 50%).
var classSampleFactors = ee.Dictionary({
  '4': 0.5
});

var minimumSamplesPerPresentClass = 0;
var proportionCalculationScale = 300;
var numberOfTrees = 100;
var randomSeed = 42;
var applyFocalMode = false;

var stableSamplingScope = 'LOCAL_BELTS';
var proportionReferenceScope = 'LOCAL_BELTS';

// --------------------------------- ASSETS -----------------------------------

var inputClassification = ee.ImageCollection(
  'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/GENERAL/' +
  'classification-ft_2ndWS'
);

var regionTraining = ee.FeatureCollection(
  'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/GENERAL/' +
  'SAMPLES/drc_regions_training'
);

var landCollection = ee.ImageCollection(
  'projects/nexgenmap/MapBiomas2/LANDSAT/DRC/mosaics-2'
);

var annualOutputFolder =
  'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/' +
  'INTEGRATION/transition_annual';
var annualOutputVersion = '1';

var stableOutputFolder =
  'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/' +
  'INTEGRATION/stable_pixels';
var stableOutputVersion = '1';

var regionVersions = {
  Miombo: '5',
  TerraFirma: '2',
  Mosaic: '2',
  Humid: '2',
  Mountain: '2'
};

var regionalPriority = [
  'Miombo',
  'TerraFirma',
  'Mosaic',
  'Humid',
  'Mountain'
];

var miomboMosaicPriority = ['Miombo', 'Mosaic'];

var bands = landCollection
  .filter(ee.Filter.eq('year', inspectionYear))
  .mosaic()
  .bandNames();

var analysisProjection = landCollection
  .filter(ee.Filter.eq('year', inspectionYear))
  .mosaic()
  .select([0])
  .projection();

// ------------------------------ VISUALIZATION -------------------------------

var palettes = require('users/mapbiomas/modules:Palettes.js');

var visLULC = {
  min: 0,
  max: 69,
  palette: palettes.get('classification9')
};

var visLandsat = {
  bands: ['swir1_median', 'nir_median', 'red_median'],
  min: 0,
  max: 5615,
  gamma: 1
};

// ----------------------- LOAD REGIONAL CLASSIFICATIONS ----------------------

var regionalImages = {};

Object.keys(regionVersions).forEach(function(region) {
  var pattern = region +
    '_gapfill_transition_temporal_spatial_v' + regionVersions[region];

  var matches = inputClassification.filter(
    ee.Filter.stringContains('system:index', pattern)
  );

  regionalImages[region] = ee.Image(matches.first());
});

// -------------------------------- HELPERS -----------------------------------

var annualBandNames = years.map(function(year) {
  return 'classification_' + year;
});

function getRegionalClassification(region, year) {
  return regionalImages[region]
    .select('classification_' + year)
    .rename('classification')
    .toByte();
}

function createClassMask(image, classIds) {
  var mask = image.eq(classIds[0]);
  for (var i = 1; i < classIds.length; i++) {
    mask = mask.or(image.eq(classIds[i]));
  }
  return mask.rename('class_mask').unmask(0);
}

function dictionaryKeysAsIntegerList(dictionary) {
  return ee.Dictionary(dictionary)
    .keys()
    .map(function(key) {
      return ee.Number.parse(ee.String(key)).int();
    })
    .sort();
}

// ----------------------------- REGION GEOMETRY ------------------------------

var miomboFeatures = regionTraining.filter(ee.Filter.eq('name', 'Miombo'));
var mosaicFeatures = regionTraining.filter(ee.Filter.eq('name', 'Mosaic'));

var miomboGeometry = miomboFeatures.geometry();
var mosaicGeometry = mosaicFeatures.geometry();
var miomboMosaicUnion = miomboGeometry.union(mosaicGeometry, geometryError);

// ------------------------- TRANSITION CORRIDOR -------------------------------

var mosaicOuterBuffer = mosaicGeometry.buffer(
  corridorHalfWidthMeters,
  geometryError
);

var mosaicInnerBuffer = mosaicGeometry.buffer(
  -corridorHalfWidthMeters,
  geometryError
);

var completeMosaicBoundaryRing = mosaicOuterBuffer.difference(
  mosaicInnerBuffer,
  geometryError
);

var miomboContactArea = miomboGeometry.buffer(
  corridorHalfWidthMeters + contactToleranceMeters,
  geometryError
);

var transitionCorridor = completeMosaicBoundaryRing
  .intersection(miomboContactArea, geometryError)
  .intersection(miomboMosaicUnion, geometryError);

var transitionCorridorMask = ee.Image.constant(1)
  .clip(transitionCorridor)
  .rename('transition_corridor')
  .setDefaultProjection(analysisProjection)
  .selfMask();

// ---------------------------- TRAINING AREAS --------------------------------

var noTrainingZone = transitionCorridor.buffer(
  trainingExclusionMeters,
  geometryError
);

var localTrainingExtent = transitionCorridor.buffer(
  trainingExclusionMeters + trainingBeltWidthMeters,
  geometryError
);

var miomboLocalTrainingArea = miomboGeometry
  .intersection(localTrainingExtent, geometryError)
  .difference(noTrainingZone, geometryError);

var mosaicLocalTrainingArea = mosaicGeometry
  .intersection(localTrainingExtent, geometryError)
  .difference(noTrainingZone, geometryError);

var localStableSamplingArea = miomboLocalTrainingArea.union(
  mosaicLocalTrainingArea,
  geometryError
);

var fullStableSamplingArea = miomboMosaicUnion.difference(
  noTrainingZone,
  geometryError
);

var stableSamplingArea = stableSamplingScope === 'LOCAL_BELTS'
  ? localStableSamplingArea
  : fullStableSamplingArea;

var proportionReferenceArea = proportionReferenceScope === 'LOCAL_BELTS'
  ? localStableSamplingArea
  : miomboMosaicUnion;

// -------------------------- TEMPORALLY STABLE MAPS --------------------------

function createStableRegionalMap(region) {
  var annualStack = regionalImages[region]
    .select(annualBandNames)
    .toInt16();

  var numberOfDistinctClasses = annualStack.reduce(
    ee.Reducer.countDistinctNonNull()
  );

  var numberOfValidYears = annualStack.reduce(ee.Reducer.count());

  var stableMask = numberOfDistinctClasses
    .eq(1)
    .and(numberOfValidYears.eq(years.length));

  return annualStack
    .select(0)
    .rename('stable')
    .updateMask(stableMask)
    .toByte();
}

var stableMiombo = createStableRegionalMap('Miombo').clip(miomboGeometry);
var stableMosaic = createStableRegionalMap('Mosaic').clip(mosaicGeometry);

var stablePreIntegrated = ee.ImageCollection.fromImages([
  stableMiombo.rename('class'),
  stableMosaic.rename('class')
])
  .mosaic()
  .rename('class')
  .toByte();

var stableSamplingAreaMask = ee.Image.constant(1)
  .clip(stableSamplingArea)
  .selfMask();

var stableReference = stablePreIntegrated
  .updateMask(stableSamplingAreaMask)
  .updateMask(stablePreIntegrated.gt(0))
  .rename('class')
  .toByte();

// --------------------------- ANNUAL INTEGRATIONS -----------------------------

function getStandardIntegration(year) {
  var images = regionalPriority.map(function(region) {
    return getRegionalClassification(region, year);
  });

  return ee.ImageCollection
    .fromImages(images)
    .mosaic()
    .rename('classification')
    .toByte();
}

function getMiomboMosaicPreIntegration(year) {
  var images = miomboMosaicPriority.map(function(region) {
    return getRegionalClassification(region, year);
  });

  return ee.ImageCollection
    .fromImages(images)
    .mosaic()
    .rename('classification')
    .toByte();
}

// ------------------ DETECT CLASSES AND SAMPLE PROPORTIONS -------------------

function getAnnualClassProportions(year) {
  var preIntegrated = getMiomboMosaicPreIntegration(year);

  var corridorClassImage = preIntegrated
    .rename('class')
    .updateMask(transitionCorridorMask)
    .updateMask(preIntegrated.gt(0));

  var corridorHistogramReduction = corridorClassImage.reduceRegion({
    reducer: ee.Reducer.frequencyHistogram(),
    geometry: transitionCorridor,
    scale: proportionCalculationScale,
    maxPixels: 1e13,
    tileScale: 8
  });

  var corridorHistogram = ee.Dictionary(
    ee.Dictionary(corridorHistogramReduction).get(
      'class',
      ee.Dictionary({})
    )
  );

  var trainingClassValues = dictionaryKeysAsIntegerList(corridorHistogram);

  var areaAndClass = ee.Image.pixelArea()
    .rename('area_m2')
    .addBands(preIntegrated.rename('class'))
    .updateMask(preIntegrated.gt(0));

  var areaReduction = areaAndClass.reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1,
      groupName: 'class'
    }),
    geometry: proportionReferenceArea,
    scale: proportionCalculationScale,
    maxPixels: 1e13,
    tileScale: 8
  });

  var groups = ee.List(
    ee.Dictionary(areaReduction).get('groups', ee.List([]))
  );

  var availableAreaDictionary = ee.Dictionary(
    groups.iterate(function(item, accumulator) {
      item = ee.Dictionary(item);
      accumulator = ee.Dictionary(accumulator);
      var key = ee.Number(item.get('class')).format('%.0f');
      return accumulator.set(key, ee.Number(item.get('sum')));
    }, ee.Dictionary({}))
  );

  var classAreas = trainingClassValues.map(function(classId) {
    var key = ee.Number(classId).format('%.0f');
    return ee.Number(availableAreaDictionary.get(key, 0));
  });

  var totalTrainingClassArea = ee.Number(
    ee.Algorithms.If(
      trainingClassValues.size().gt(0),
      classAreas.reduce(ee.Reducer.sum()),
      0
    )
  );

  var safeTotalArea = totalTrainingClassArea.max(1);
  var effectiveMinimumSamples = ee.Number(
    minimumSamplesPerPresentClass
  ).max(1);

  var classProportions = classAreas.map(function(area) {
    return ee.Number(area).divide(safeTotalArea);
  });

  var proportionalSampleCounts = trainingClassValues.map(function(classId) {
    var key = ee.Number(classId).format('%.0f');
    var area = ee.Number(availableAreaDictionary.get(key, 0));
    return area
      .divide(safeTotalArea)
      .multiply(totalAnnualSamples)
      .round()
      .max(effectiveMinimumSamples)
      .int();
  });

  var appliedSampleFactors = trainingClassValues.map(function(classId) {
    var key = ee.Number(classId).format('%.0f');
    return ee.Number(classSampleFactors.get(key, 1.0));
  });

  var requestedSampleCounts = trainingClassValues.map(function(classId) {
    var key = ee.Number(classId).format('%.0f');
    var area = ee.Number(availableAreaDictionary.get(key, 0));
    var factor = ee.Number(classSampleFactors.get(key, 1.0));

    return area
      .divide(safeTotalArea)
      .multiply(totalAnnualSamples)
      .round()
      .max(effectiveMinimumSamples)
      .multiply(factor)
      .round()
      .max(effectiveMinimumSamples)
      .int();
  });

  var classKeys = trainingClassValues.map(function(classId) {
    return ee.Number(classId).format('%.0f');
  });

  return {
    preIntegrated: preIntegrated,
    corridorHistogram: corridorHistogram,
    trainingClassValues: trainingClassValues,
    classAreas: classAreas,
    classProportions: classProportions,
    proportionalSampleCounts: proportionalSampleCounts,
    appliedSampleFactors: appliedSampleFactors,
    requestedSampleCounts: requestedSampleCounts,
    areaDictionary: ee.Dictionary.fromLists(classKeys, classAreas),
    proportionDictionary: ee.Dictionary.fromLists(
      classKeys,
      classProportions
    ),
    proportionalSampleCountDictionary: ee.Dictionary.fromLists(
      classKeys,
      proportionalSampleCounts
    ),
    sampleFactorDictionary: ee.Dictionary.fromLists(
      classKeys,
      appliedSampleFactors
    ),
    sampleCountDictionary: ee.Dictionary.fromLists(
      classKeys,
      requestedSampleCounts
    ),
    totalTrainingClassArea: totalTrainingClassArea
  };
}

// ---------------------- LANDSAT AND STABLE SAMPLES --------------------------

function getAnnualPredictors(year) {
  return landCollection
    .filter(ee.Filter.eq('year', year))
    .filterBounds(miomboMosaicUnion)
    .mosaic()
    .select(bands)
    .toFloat();
}

function getAnnualStableTrainingData(year) {
  var predictors = getAnnualPredictors(year);
  var proportionData = getAnnualClassProportions(year);

  var samplingImage = predictors.addBands(stableReference);

  var trainingSamples = samplingImage.stratifiedSample({
    numPoints: 0,
    classBand: 'class',
    region: stableSamplingArea,
    scale: stableSampleScale,
    seed: randomSeed + year,
    classValues: proportionData.trainingClassValues,
    classPoints: proportionData.requestedSampleCounts,
    dropNulls: true,
    tileScale: 8,
    geometries: false
  });

  var sampledClassValues = dictionaryKeysAsIntegerList(
    trainingSamples.aggregate_histogram('class')
  );

  var missingStableClasses = proportionData.trainingClassValues.removeAll(
    sampledClassValues
  );

  return {
    samples: trainingSamples,
    sampledClassValues: sampledClassValues,
    missingStableClasses: missingStableClasses,
    predictors: predictors,
    preIntegrated: proportionData.preIntegrated,
    corridorHistogram: proportionData.corridorHistogram,
    trainingClassValues: proportionData.trainingClassValues,
    areaDictionary: proportionData.areaDictionary,
    proportionDictionary: proportionData.proportionDictionary,
    proportionalSampleCounts: proportionData.proportionalSampleCounts,
    proportionalSampleCountDictionary:
      proportionData.proportionalSampleCountDictionary,
    appliedSampleFactors: proportionData.appliedSampleFactors,
    sampleFactorDictionary: proportionData.sampleFactorDictionary,
    requestedSampleCounts: proportionData.requestedSampleCounts,
    sampleCountDictionary: proportionData.sampleCountDictionary,
    totalTrainingClassArea: proportionData.totalTrainingClassArea
  };
}

// -------------------------- TRAIN AND CLASSIFY -------------------------------

function classifyAnnualTransition(year) {
  var trainingData = getAnnualStableTrainingData(year);

  var classifier = ee.Classifier
    .smileRandomForest({
      numberOfTrees: numberOfTrees,
      variablesPerSplit: null,
      minLeafPopulation: 5,
      bagFraction: 0.7,
      maxNodes: null,
      seed: randomSeed
    })
    .train({
      features: trainingData.samples,
      classProperty: 'class',
      inputProperties: bands
    });

  var corridorPredictors = trainingData.predictors.updateMask(
    transitionCorridorMask
  );

  var transitionClassification = corridorPredictors
    .classify(classifier)
    .rename('classification')
    .updateMask(transitionCorridorMask)
    .toByte();

  if (applyFocalMode) {
    transitionClassification = transitionClassification
      .focalMode({
        radius: 1,
        kernelType: 'square',
        units: 'pixels',
        iterations: 1
      })
      .updateMask(transitionCorridorMask)
      .rename('classification')
      .toByte();
  }

  return {
    classification: transitionClassification,
    classifier: classifier,
    samples: trainingData.samples,
    sampledClassValues: trainingData.sampledClassValues,
    missingStableClasses: trainingData.missingStableClasses,
    preIntegrated: trainingData.preIntegrated,
    corridorHistogram: trainingData.corridorHistogram,
    trainingClassValues: trainingData.trainingClassValues,
    areaDictionary: trainingData.areaDictionary,
    proportionDictionary: trainingData.proportionDictionary,
    proportionalSampleCounts: trainingData.proportionalSampleCounts,
    proportionalSampleCountDictionary:
      trainingData.proportionalSampleCountDictionary,
    appliedSampleFactors: trainingData.appliedSampleFactors,
    sampleFactorDictionary: trainingData.sampleFactorDictionary,
    requestedSampleCounts: trainingData.requestedSampleCounts,
    sampleCountDictionary: trainingData.sampleCountDictionary
  };
}

// ----------------------- SPATIAL FEATHERING ---------------------------------

/**
 * buildFeatheredIntegration: Integrates the RF ecotone candidate into the 
 * standard classification map. 
 * 
 * Uses distance-weighted smoothstep weights, local focal prevalence, 
 * stochastic dithering to avoid solid lines, and conditional rule overrides 
 * to protect original Class 4 margins from aggressive spatial smoothing.
 */
function buildFeatheredIntegration(
  standardIntegration,
  annualMiomboMosaicReference,
  transitionClassification,
  year
) {
  var corridorBinary = transitionCorridorMask
    .unmask(0)
    .rename('corridor')
    .toByte();

  var eligibleOriginalClassMask = createClassMask(
    annualMiomboMosaicReference,
    transitionClasses
  );

  var acceptedPredictionClassMask = createClassMask(
    transitionClassification,
    transitionClasses
  );

  var validPredictionMask = transitionClassification.mask().unmask(0);

  var baseReplacementMask = eligibleOriginalClassMask
    .and(acceptedPredictionClassMask)
    .and(corridorBinary)
    .and(validPredictionMask)
    .unmask(0);

  var candidateMiomboMosaic = annualMiomboMosaicReference
    .where(baseReplacementMask, transitionClassification)
    .rename('classification')
    .toByte();

  var prevalenceProcessingGeometry = transitionCorridor.buffer(
    prevalenceRadiusMeters,
    geometryError
  );

  var prevalenceProcessingMask = ee.Image.constant(1)
    .clip(prevalenceProcessingGeometry)
    .selfMask();

  // --- CLEAN DISTANCE CALCULATION ---
  // Calculates linear distance from the corridor edge inward.
  var featherWidthPixels = Math.max(1, Math.ceil(featherWidthMeters / classificationScale));

  var distanceFromCorridorEdgePixels = corridorBinary
    .not()
    .fastDistanceTransform(featherWidthPixels + 2, 'pixels', 'squared_euclidean')
    .sqrt()
    .unmask(featherWidthPixels + 1)
    .updateMask(corridorBinary)
    .rename('distance_from_corridor_edge_pixels');

  // rfWeightLinear scales distance from 0 (at edge) to 1 (at featherWidthMeters)
  var rfWeightLinear = distanceFromCorridorEdgePixels
    .divide(featherWidthPixels)
    .max(0)
    .min(1)
    .rename('rf_weight_linear');

  // SMOOTHSTEP WEIGHTING FUNCTION
  // Formula: w = w_linear^2 * (3 - 2*w_linear)
  // Replaces linear blending with an 'S-curve' ensuring gentle fading 
  // on both edges of the ecotone, smoothing out visual abruptness.
  var rfWeight = rfWeightLinear
    .multiply(rfWeightLinear)
    .multiply(
      ee.Image.constant(3).subtract(rfWeightLinear.multiply(2))
    )
    .rename('rf_weight');

  var originalWeight = ee.Image.constant(1)
    .subtract(rfWeight)
    .rename('original_weight');

  function createTransitionClassOneHot(image, prefix) {
    return ee.Image.cat([
      image.eq(3).rename(prefix + '_3'),
      image.eq(4).rename(prefix + '_4'),
      image.eq(66).rename(prefix + '_66')
    ])
      .updateMask(prevalenceProcessingMask)
      .unmask(0)
      .clip(prevalenceProcessingGeometry)
      .toFloat();
  }

  var originalOneHot = createTransitionClassOneHot(
    annualMiomboMosaicReference,
    'original'
  );

  var candidateOneHot = createTransitionClassOneHot(
    candidateMiomboMosaic,
    'candidate'
  );

  var originalPrevalence = originalOneHot.focalMean({
    radius: prevalenceRadiusMeters,
    kernelType: 'circle',
    units: 'meters',
    iterations: 1
  });

  var candidatePrevalence = candidateOneHot.focalMean({
    radius: prevalenceRadiusMeters,
    kernelType: 'circle',
    units: 'meters',
    iterations: 1
  });

  function makeScore(classId) {
    var key = String(classId);
    var originalBand = originalPrevalence.select('original_' + key);
    var candidateBand = candidatePrevalence.select('candidate_' + key);
    var factor = ee.Number(classDecisionFactors.get(key, 1.0));

    return originalBand
      .multiply(originalWeight)
      .add(candidateBand.multiply(rfWeight))
      .multiply(factor)
      .add(
        annualMiomboMosaicReference
          .eq(classId)
          .multiply(originalClassTieBreak)
      )
      .rename('score_' + key);
  }

  var score3 = makeScore(3);
  var score4 = makeScore(4);
  var score66 = makeScore(66);

  var originalClassScore = score3
    .where(annualMiomboMosaicReference.eq(4), score4)
    .where(annualMiomboMosaicReference.eq(66), score66)
    .rename('original_class_score');

  var predictedClassScore = score3
    .where(transitionClassification.eq(4), score4)
    .where(transitionClassification.eq(66), score66)
    .add(rfWeight.multiply(rfPredictionBonus))
    .rename('predicted_class_score');

  var predictedSupportGain = predictedClassScore
    .subtract(originalClassScore)
    .rename('predicted_support_gain');

  // --- REQUIRED SUPPORT GAIN (DECISION THRESHOLD) ---
  // The threshold required for the RF class to successfully overwrite the original map.
  
  // 1. STOCHASTIC DITHERING
  // Adds a localized random noise variance (up to spatialDitherMagnitude) 
  // to the required threshold. Breaking up geometric lines creates a 
  // 'salt-and-pepper' natural transition patchiness.
  var spatialDither = ee.Image.random(randomSeed)
    .multiply(spatialDitherMagnitude)
    .rename('spatial_dither');

  // 2. CLASS 4 EDGE PROTECTION
  // If a pixel was explicitly Class 4 on the original map, it gets a heavy penalty.
  // This physically blocks Class 66 from bleeding backwards into the Miombo zone.
  var localClass4Protection = annualMiomboMosaicReference.eq(4)
    .multiply(originalWeight)
    .multiply(class4ProtectionPenalty)
    .rename('class_4_protection');

  // 3. COMBINED THRESHOLD ALGORITHM
  // Threshold = Base Minimum + (Edge Penalty * Original Weight) + Class 4 Rule + Stochastic Noise
  var requiredSupportGain = ee.Image.constant(minimumPrevalenceGain)
    .add(
      ee.Image.constant(edgePreservationPenalty).multiply(originalWeight)
    )
    .add(localClass4Protection)
    .add(spatialDither)
    .rename('required_support_gain');

  // The RF candidate ONLY overwrites if its prevalence gain surpasses the dynamic threshold.
  var featheredReplacementMask = baseReplacementMask
    .and(transitionClassification.neq(annualMiomboMosaicReference))
    .and(predictedSupportGain.gte(requiredSupportGain))
    .unmask(0)
    .rename('feathered_replacement_mask');

  var integrated = standardIntegration
    .where(featheredReplacementMask, transitionClassification)
    .rename('classification_' + year) // Ensures correct band naming
    .toByte()
    .set({
      year: year,
      country: countryName,
      integration_method: 'Stochastic decision feathering with dedicated Class 4 edge protection',
      stable_period: years[0] + '-' + years[years.length - 1],
      corridor_half_width_m: corridorHalfWidthMeters,
      feather_width_m: featherWidthMeters,
      prevalence_radius_m: prevalenceRadiusMeters,
      minimum_prevalence_gain: minimumPrevalenceGain,
      edge_preservation_penalty: edgePreservationPenalty,
      rf_prediction_bonus: rfPredictionBonus,
      class_4_protection_penalty: class4ProtectionPenalty,
      spatial_dither_magnitude: spatialDitherMagnitude,
      integrated_classes: transitionClasses.join(','),
      annual_sample_budget_before_factors: totalAnnualSamples,
      class_4_sample_factor: classSampleFactors.get('4', 1.0),
      stable_sampling_scope: stableSamplingScope,
      proportion_reference_scope: proportionReferenceScope
    });

  return {
    integrated: integrated,
    candidateMiomboMosaic: candidateMiomboMosaic,
    corridorBinary: corridorBinary,
    distanceFromCorridorEdgePixels: distanceFromCorridorEdgePixels,
    rfWeight: rfWeight,
    originalWeight: originalWeight,
    originalClassScore: originalClassScore,
    predictedClassScore: predictedClassScore,
    predictedSupportGain: predictedSupportGain,
    requiredSupportGain: requiredSupportGain,
    baseReplacementMask: baseReplacementMask,
    featheredReplacementMask: featheredReplacementMask
  };
}

function applyTransitionClassification(
  standardIntegration,
  annualMiomboMosaicReference,
  transitionClassification,
  year
) {
  return buildFeatheredIntegration(
    standardIntegration,
    annualMiomboMosaicReference,
    transitionClassification,
    year
  ).integrated;
}

function integrateOneYear(year) {
  var standardIntegration = getStandardIntegration(year);
  var transitionResult = classifyAnnualTransition(year);

  return applyTransitionClassification(
    standardIntegration,
    transitionResult.preIntegrated,
    transitionResult.classification,
    year
  );
}

// ------------------------------- INSPECTION ---------------------------------

if (runInspection) {
  var inspectionTransition = classifyAnnualTransition(inspectionYear);
  var inspectionBefore = getStandardIntegration(inspectionYear);

  var inspectionFeatherResult = buildFeatheredIntegration(
    inspectionBefore,
    inspectionTransition.preIntegrated,
    inspectionTransition.classification,
    inspectionYear
  );

  var inspectionAfter = inspectionFeatherResult.integrated;

  print(
    'All classes detected in corridor ' + inspectionYear,
    inspectionTransition.trainingClassValues
  );
  
  Map.addLayer(
    getAnnualPredictors(inspectionYear),
    visLandsat,
    'Landsat ' + inspectionYear,
    false
  );
  Map.addLayer(
    inspectionTransition.preIntegrated,
    visLULC,
    'Miombo-Mosaic pre-integration ' + inspectionYear,
    false
  );
  Map.addLayer(
    getRegionalClassification('Miombo', inspectionYear),
    visLULC,
    'Original Miombo ' + inspectionYear,
    false
  );
  Map.addLayer(
    getRegionalClassification('Mosaic', inspectionYear),
    visLULC,
    'Original Mosaic ' + inspectionYear,
    false
  );
  Map.addLayer(
    inspectionBefore,
    visLULC,
    'National integration before transition ' + inspectionYear,
    false
  );
  Map.addLayer(
    inspectionTransition.classification,
    visLULC,
    'RF all-class corridor ' + inspectionYear,
    false
  );
  Map.addLayer(
    inspectionAfter,
    visLULC,
    'Final feathered integration ' + inspectionYear,
    true
  );

  var changedPixels = inspectionAfter
    .neq(inspectionBefore.rename('classification_' + inspectionYear))
    .selfMask();

  Map.addLayer(
    changedPixels,
    {min: 1, max: 1, palette: ['FF0000']},
    'Pixels changed ' + inspectionYear,
    false
  );

  Map.addLayer(
    inspectionFeatherResult.baseReplacementMask.selfMask(),
    {min: 1, max: 1, palette: ['00FF00']},
    'Original hard replacement mask ' + inspectionYear,
    false
  );

  Map.addLayer(
    inspectionFeatherResult.featheredReplacementMask.selfMask(),
    {min: 1, max: 1, palette: ['00FFFF']},
    'Feathered replacement mask ' + inspectionYear,
    false
  );

  Map.addLayer(
    inspectionFeatherResult.rfWeight,
    {min: 0, max: 1},
    'RF feather weight ' + inspectionYear,
    false
  );
}

// -------------------------- OPTIONAL STABLE EXPORTS -------------------------

if (createStableMapExportTasks) {
  var stableMiomboName = countryName +
    '_stable_Miombo_' + years[0] + '_' + years[years.length - 1] +
    '_v' + stableOutputVersion;

  Export.image.toAsset({
    image: stableMiombo.rename('stable'),
    description: stableMiomboName,
    assetId: stableOutputFolder + '/' + stableMiomboName,
    region: miomboGeometry.bounds(),
    scale: classificationScale,
    maxPixels: 1e13,
    pyramidingPolicy: {'.default': 'mode'}
  });

  var stableMosaicName = countryName +
    '_stable_Mosaic_' + years[0] + '_' + years[years.length - 1] +
    '_v' + stableOutputVersion;

  Export.image.toAsset({
    image: stableMosaic.rename('stable'),
    description: stableMosaicName,
    assetId: stableOutputFolder + '/' + stableMosaicName,
    region: mosaicGeometry.bounds(),
    scale: classificationScale,
    maxPixels: 1e13,
    pyramidingPolicy: {'.default': 'mode'}
  });
}

// ---------------------- COMPLETE DRC ANNUAL EXPORTS -------------------------

if (createAnnualExportTasks) {
  
  // 1. Generate a list of integrated, single-band images for every year
  var annualImagesList = years.map(function(year) {
    // The integrateOneYear function already renames the output band to 'classification_' + year
    return integrateOneYear(year);
  });
  
  // 2. Concatenate the list of single-band images into one multi-band image
  var multibandIntegratedImage = ee.Image.cat(annualImagesList);
  
  // 3. Define export parameters
  var exportAssetId = 'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/INTEGRATION/classificationDRC_classification_integrated_v2';
  var exportDescription = 'classificationDRC_classification_integrated_v2';

  // 4. Create a single export task
  Export.image.toAsset({
    image: multibandIntegratedImage,
    description: exportDescription,
    assetId: exportAssetId,
    region: regionTraining.geometry().bounds(),
    scale: classificationScale,
    maxPixels: 1e13,
    pyramidingPolicy: {'.default': 'mode'}
  });
}

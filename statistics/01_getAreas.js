// =============================================================================
// MAPBIOMAS DRC - COLLECTION 1
// Export LULC area PER YEAR and PER TERRITORY SET
//
// Output:
//   1 CSV per territory type per year
//
// Examples:
//   drc_col1_lulc_area_province_2000.csv
//   drc_col1_lulc_area_province_2001.csv
//   ...
//   drc_col1_lulc_area_territory_2025.csv
//   drc_col1_lulc_area_protected_area_2025.csv
//
// Total tasks: 4 territory sets x 26 years = 104 tasks
// =============================================================================


// =============================================================================
// 1. CLASSIFICATION
// =============================================================================

var collection = ee.Image(
  'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/INTEGRATION/' +
  'classificationDRC_classification_integrated_v10'
);

// Mask unclassified pixels
var classification = collection.selfMask();


// =============================================================================
// 2. PARAMETERS
// =============================================================================

var scale = 30;

var years = [
  2000, 2001, 2002, 2003, 2004, 2005,
  2006, 2007, 2008, 2009, 2010, 2011,
  2012, 2013, 2014, 2015, 2016, 2017,
  2018, 2019, 2020, 2021, 2022, 2023,
  2024, 2025
];

// All CSV files will go into this same Drive folder
var driveFolder = 'mapbiomas-drc-col1-lulc-area-yearly';


// =============================================================================
// 3. TERRITORY DATASETS
// =============================================================================

var territorySets = [

  {
    name: 'province',

    asset:
      'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/' +
      'Limite_Province_RDC_reproj',

    idField: 'CODE_INS'
  },

  {
    name: 'country',

    asset:
      'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/' +
      'Limite_RDC_reproj',

    idField: 'CODE_INS'
  },

  {
    name: 'territory',

    asset:
      'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/' +
      'Limite_territoire_RDC_reproj',

    idField: 'CODE_INS'
  },

  {
    name: 'protected_area',

    asset:
      'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/' +
      'RDC_aires_protegees',

    idField: 'OBJECTID_1'
  }

];


// =============================================================================
// 4. PIXEL AREA
// =============================================================================

// Pixel area in hectares
var pixelArea = ee.Image.pixelArea()
  .divide(10000)
  .rename('area');


// =============================================================================
// 5. CONVERT GROUPED REDUCER RESULT TO FEATURE COLLECTION
// =============================================================================

var convert2table = function(obj) {

  obj = ee.Dictionary(obj);

  var territoryId = obj.get('territory');

  var classesAndAreas = ee.List(
    obj.get('groups')
  );


  var rows = classesAndAreas.map(function(classAndArea) {

    classAndArea = ee.Dictionary(classAndArea);

    var classId = classAndArea.get('class');

    var area = classAndArea.get('sum');


    return ee.Feature(null)
      .set('territory', territoryId)
      .set('class_id', classId)
      .set('area', area);

  });


  return ee.FeatureCollection(rows);

};


// =============================================================================
// 6. AREA CALCULATION
// =============================================================================
//
// Input image bands:
//
//   0 = area
//   1 = territory
//   2 = class
//
// Group first by class and then by territory.
//
// =============================================================================

var calculateArea = function(
  lulcImage,
  territoryImage,
  geometry
) {

  var data = pixelArea

    .addBands(territoryImage)

    .addBands(
      lulcImage.rename('class')
    )

    .reduceRegion({

      reducer: ee.Reducer
        .sum()

        .group({
          groupField: 1,
          groupName: 'class'
        })

        .group({
          groupField: 1,
          groupName: 'territory'
        }),

      geometry: geometry,

      scale: scale,

      maxPixels: 1e13,

      tileScale: 4

    });


  var groups = ee.List(
    ee.Dictionary(data).get('groups')
  );


  var areas = groups.map(
    convert2table
  );


  return ee.FeatureCollection(
    areas
  ).flatten();

};


// =============================================================================
// 7. PROCESS EACH TERRITORY DATASET
// =============================================================================

territorySets.forEach(function(config) {


  // ===========================================================================
  // 7.1 READ VECTOR
  // ===========================================================================

  var territoryVector = ee.FeatureCollection(
    config.asset
  );


  print(
    '--------------------------------------------------'
  );

  print(
    'Territory type:',
    config.name
  );

  print(
    'Asset:',
    config.asset
  );

  print(
    'ID field:',
    config.idField
  );

  print(
    'Number of features:',
    territoryVector.size()
  );


  // ===========================================================================
  // 7.2 CREATE NUMERIC TERRITORY ID
  // ===========================================================================

  territoryVector = territoryVector.map(
    function(feature) {

      var territoryId = ee.Number.parse(
        ee.String(
          feature.get(config.idField)
        )
      );


      return feature.set(
        'territory_id',
        territoryId
      );

    }
  );


  // ===========================================================================
  // 7.3 RASTERIZE TERRITORIES
  // ===========================================================================

  var territoryImage = ee.Image()
    .paint({
      featureCollection: territoryVector,
      color: 'territory_id'
    })
    .rename('territory')
    .toInt64();


  // ===========================================================================
  // 7.4 MAP QA - RASTERIZED TERRITORIES
  // ===========================================================================

  Map.addLayer(

    territoryImage.randomVisualizer(),

    {},

    'RASTER - ' + config.name,

    false,

    0.7

  );


  // ===========================================================================
  // 7.5 MAP QA - ORIGINAL VECTOR
  // ===========================================================================

  var vectorStyle = territoryVector.style({

    color: '000000',

    fillColor: '00000000',

    width: 1

  });


  Map.addLayer(

    vectorStyle,

    {},

    'VECTOR - ' + config.name,

    false

  );


  // ===========================================================================
  // 7.6 PROCESSING GEOMETRY
  // ===========================================================================

  var geometry = territoryVector.geometry();


  // ===========================================================================
  // 7.7 CREATE ONE EXPORT PER YEAR
  // ===========================================================================

  years.forEach(function(year) {


    // -------------------------------------------------------------------------
    // Select classification year
    // -------------------------------------------------------------------------

    var lulcYear = classification.select(
      'classification_' + year
    );


    // -------------------------------------------------------------------------
    // Calculate area
    // -------------------------------------------------------------------------

    var areas = calculateArea(

      lulcYear,

      territoryImage,

      geometry

    );


    // -------------------------------------------------------------------------
    // Add standardized metadata
    // -------------------------------------------------------------------------

    areas = areas.map(function(feature) {

      return feature

        .set(
          'territory_type',
          config.name
        )

        .set(
          'year',
          year
        );

    });


    // -------------------------------------------------------------------------
    // Standardized filename
    //
    // Example:
    // drc_col1_lulc_area_province_2000
    // drc_col1_lulc_area_territory_2015
    // drc_col1_lulc_area_protected_area_2025
    // -------------------------------------------------------------------------

    var outputName =

      'drc_col1_lulc_area_' +

      config.name +

      '_' +

      year;


    // -------------------------------------------------------------------------
    // EXPORT
    // -------------------------------------------------------------------------

    Export.table.toDrive({

      collection: areas,

      description: outputName,

      folder: driveFolder,

      fileNamePrefix: outputName,

      fileFormat: 'CSV',

      selectors: [

        'territory',

        'territory_type',

        'class_id',

        'year',

        'area'

      ]

    });


    print(
      'Export created:',
      outputName
    );


  });

});


// =============================================================================
// 8. CENTER MAP OVER DRC
// =============================================================================

var drcBoundary = ee.FeatureCollection(
  'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/' +
  'Limite_RDC_reproj'
);

Map.centerObject(
  drcBoundary,
  5
);


// =============================================================================
// 9. OPTIONAL CLASSIFICATION LAYER
// =============================================================================

Map.addLayer(

  classification.select(
    'classification_2025'
  ),

  {
    min: 0,
    max: 62
  },

  'Classification 2025',

  false

);


// =============================================================================
// EXPECTED EXPORTS
// =============================================================================
//
// PROVINCE
// drc_col1_lulc_area_province_2000.csv
// drc_col1_lulc_area_province_2001.csv
// ...
// drc_col1_lulc_area_province_2025.csv
//
// COUNTRY
// drc_col1_lulc_area_country_2000.csv
// ...
// drc_col1_lulc_area_country_2025.csv
//
// TERRITORY
// drc_col1_lulc_area_territory_2000.csv
// ...
// drc_col1_lulc_area_territory_2025.csv
//
// PROTECTED AREA
// drc_col1_lulc_area_protected_area_2000.csv
// ...
// drc_col1_lulc_area_protected_area_2025.csv
//
// =============================================================================

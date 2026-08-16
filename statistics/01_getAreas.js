// Export land cover / land use area yearly by territory sets
// MapBiomas DRC - Collection 1
// dhemerson.costa@ipam.org.br


// -----------------------------------------------------------------------------
// 1. READ CLASSIFICATION
// -----------------------------------------------------------------------------

var collection = ee.Image(
  'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/INTEGRATION/' +
  'classificationDRC_classification_integrated_v10'
);

// Mask pixels without classification
var asset_i = collection.selfMask();


// -----------------------------------------------------------------------------
// 2. PARAMETERS
// -----------------------------------------------------------------------------

// Change scale if needed
var scale = 30;

// Years to process
var years = [
  2000, 2001, 2002, 2003, 2004, 2005,
  2006, 2007, 2008, 2009, 2010, 2011,
  2012, 2013, 2014, 2015, 2016, 2017,
  2018, 2019, 2020, 2021, 2022, 2023,
  2024, 2025
];

// Google Drive output folder
var driveFolder = 'mapbiomas-drc-col1-lulc-area';


// -----------------------------------------------------------------------------
// 3. TERRITORY CONFIGURATION
// -----------------------------------------------------------------------------

var territorySets = [

  {
    name: 'province',
    asset: 'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/Limite_Province_RDC_reproj',
    idField: 'CODE_INS'
  },

  {
    name: 'country',
    asset: 'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/Limite_RDC_reproj',
    idField: 'CODE_INS'
  },

  {
    name: 'territory',
    asset: 'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/Limite_territoire_RDC_reproj',
    idField: 'CODE_INS'
  },

  {
    name: 'protected_area',
    asset: 'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/RDC_aires_protegees',
    idField: 'OBJECTID_1'
  }

];


// -----------------------------------------------------------------------------
// 4. PIXEL AREA
// -----------------------------------------------------------------------------

// Pixel area in hectares
var pixelArea = ee.Image.pixelArea()
  .divide(10000)
  .rename('area');


// -----------------------------------------------------------------------------
// 5. CONVERT GROUPED REDUCER OUTPUT TO TABLE
// -----------------------------------------------------------------------------

var convert2table = function(obj) {

  obj = ee.Dictionary(obj);

  var territoryId = obj.get('territory');

  var classesAndAreas = ee.List(obj.get('groups'));

  var tableRows = classesAndAreas.map(function(classAndArea) {

    classAndArea = ee.Dictionary(classAndArea);

    var classId = classAndArea.get('class');
    var area = classAndArea.get('sum');

    return ee.Feature(null)
      .set('territory', territoryId)
      .set('class_id', classId)
      .set('area', area);

  });

  return ee.FeatureCollection(tableRows);
};


// -----------------------------------------------------------------------------
// 6. CALCULATE AREA
// -----------------------------------------------------------------------------

var calculateArea = function(image, territoryImage, geometry) {

  // Band order:
  // 0 = area
  // 1 = territory
  // 2 = classification

  var territoriesData = pixelArea
    .addBands(territoryImage)
    .addBands(image.rename('class'))
    .reduceRegion({

      reducer: ee.Reducer.sum()
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

  var groupedData = ee.List(
    ee.Dictionary(territoriesData).get('groups')
  );

  var areas = groupedData.map(convert2table);

  return ee.FeatureCollection(areas).flatten();
};


// -----------------------------------------------------------------------------
// 7. PROCESS EACH TERRITORY SET
// -----------------------------------------------------------------------------

territorySets.forEach(function(config) {

  print('--------------------------------------------------');
  print('Processing:', config.name);
  print('Asset:', config.asset);
  print('ID field:', config.idField);


  // ---------------------------------------------------------------------------
  // Read vector
  // ---------------------------------------------------------------------------

  var territoryVector = ee.FeatureCollection(config.asset);

  print(
    'Number of features - ' + config.name,
    territoryVector.size()
  );

  print(
    'First feature - ' + config.name,
    territoryVector.first()
  );


  // ---------------------------------------------------------------------------
  // Create standardized numerical territory ID
  // ---------------------------------------------------------------------------

  territoryVector = territoryVector.map(function(feature) {

    var territoryId = ee.Number.parse(
      ee.String(feature.get(config.idField))
    );

    return feature.set('territory_id', territoryId);

  });


  // ---------------------------------------------------------------------------
  // Rasterize territories
  // ---------------------------------------------------------------------------

  var territoryImage = ee.Image()
    .paint({
      featureCollection: territoryVector,
      color: 'territory_id'
    })
    .rename('territory')
    .toInt64();


  // ---------------------------------------------------------------------------
  // MAP QA - RASTER
  // ---------------------------------------------------------------------------

  Map.addLayer(
    territoryImage.randomVisualizer(),
    {},
    'RASTER - ' + config.name,
    false,
    0.7
  );


  // ---------------------------------------------------------------------------
  // MAP QA - VECTOR BOUNDARIES
  // ---------------------------------------------------------------------------

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


  // ---------------------------------------------------------------------------
  // Processing geometry
  // ---------------------------------------------------------------------------

  var geometry = territoryVector.geometry();


  // ---------------------------------------------------------------------------
  // Calculate area for every year
  // ---------------------------------------------------------------------------

  var areas = years.map(function(year) {

    var image = asset_i.select(
      'classification_' + year
    );

    var yearlyAreas = calculateArea(
      image,
      territoryImage,
      geometry
    );


    // Add metadata
    yearlyAreas = yearlyAreas.map(function(feature) {

      return feature
        .set('year', year)
        .set('territory_type', config.name);

    });

    return yearlyAreas;

  });


  // Flatten all years into one table
  areas = ee.FeatureCollection(areas).flatten();


  // ---------------------------------------------------------------------------
  // Standardized output name
  // ---------------------------------------------------------------------------

  var outputName =
    'drc_col1_lulc_area_' +
    config.name +
    '_2000_2025';


  // ---------------------------------------------------------------------------
  // Check output in console
  // ---------------------------------------------------------------------------

  print(
    'Output sample - ' + config.name,
    areas.limit(10)
  );

  print(
    'Number of rows - ' + config.name,
    areas.size()
  );


  // ---------------------------------------------------------------------------
  // Export CSV
  // ---------------------------------------------------------------------------

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
    'Export task created:',
    outputName
  );

});


// -----------------------------------------------------------------------------
// 8. CENTER MAP OVER DRC
// -----------------------------------------------------------------------------

var drcBoundary = ee.FeatureCollection(
  'projects/mapbiomas-drc/assets/TERRITORIES/COL-1/Limite_RDC_reproj'
);

Map.centerObject(drcBoundary, 5);


// -----------------------------------------------------------------------------
// 9. OPTIONAL CLASSIFICATION LAYER FOR VISUAL REFERENCE
// -----------------------------------------------------------------------------

// Turn this on if you want to compare territory boundaries/rasterization
// against the land-cover map.

var classification2025 = asset_i.select(
  'classification_2025'
);

Map.addLayer(
  classification2025,
  {
    min: 0,
    max: 62
  },
  'Classification 2025',
  false
);


// -----------------------------------------------------------------------------
// OUTPUT TASKS CREATED:
//
// drc_col1_lulc_area_province_2000_2025
// drc_col1_lulc_area_country_2000_2025
// drc_col1_lulc_area_territory_2000_2025
// drc_col1_lulc_area_protected_area_2000_2025
//
// Drive folder:
// mapbiomas-drc-col1-lulc-area
//
// Layers available for QA:
//
// RASTER - province
// VECTOR - province
//
// RASTER - country
// VECTOR - country
//
// RASTER - territory
// VECTOR - territory
//
// RASTER - protected_area
// VECTOR - protected_area
// -----------------------------------------------------------------------------

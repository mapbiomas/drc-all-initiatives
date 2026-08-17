/**** DESCRIPTION
 * Author: MapBiomas RDC
 * Date: October 30, 2025
 * Version 7
 * 
 * This script provides a Sample Validation User Interface (UI) in Google Earth Engine (GEE).
 * It allows multiple users to merge, visually inspect, correct, or remove sample collections.
 * 
 * Main functions:
 * 1) Loads and merges sample FeatureCollections from multiple users.
 * 2) Displays samples with color-coded styling based on class labels.
 * 3) Interactive validation: jump to samples, view class, highlight, modify, or delete.
 * 4) Maintains a real-time validated FeatureCollection.
 * 5) Export validated data to Earth Engine Assets or Google Drive (SHP).
 ***************************************************************************************/

// ##################################################################################
/**** CONFIGURATION ****/
var map = Map; 
map.setOptions('hybrid');

map.drawingTools()
  .setShown(true)
  .setLinked(true);

var region_name = 'Humid', // CHANGE BIOME NAME
    region_folder = region_name.toUpperCase();
var country_name = 'DRC';
var version = 1;

var BIOME_ROOT_FOLDER = 'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/' + region_folder;
var SAMPLES_FOLDER = BIOME_ROOT_FOLDER + '/SAMPLES';
var EXPORT_ASSET_NAME = BIOME_ROOT_FOLDER + '/' + region_name + '_validated_samples_v' + version;
var EXPORT_TRAINED_NAME = BIOME_ROOT_FOLDER + '/trained_Samples_'+ country_name + '_' + region_name + '_v' + version;

// Define the visualization parameters for the Landsat mosaic
var Land_collection = ee.ImageCollection('projects/nexgenmap/MapBiomas2/LANDSAT/DRC/mosaics-2');
var visLandsat = {
  "bands": ["swir1_median", "nir_median", "red_median"],
  "min": 0, "max": 5615, "gamma":1
};

// Define years to extract spectral signatures and build a spectral library 
var years = [
          // 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009,
          // 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019,
          // 2020, 2021, 2022, 2023, 2024
          2000, 2005, 2010, 2015, 2020, 2024
           ];
// Initialize a empty collection for the spectral library 
var trainedSamples_allyears = ee.FeatureCollection([]);

// Plot mosaics for first and last year 
Map.addLayer(Land_collection.filter(ee.Filter.eq('year', 2000)).filterBounds(regions), visLandsat, 'Landsat 2000');
Map.addLayer(Land_collection.filter(ee.Filter.eq('year', 2024)).filterBounds(regions), visLandsat, 'Landsat 2024');

var currentFeature = null;
var currentIndex = 0;
var bufferTolerance = 15; // meters
var timeLabel = ui.Label('', {
  fontSize: '10px',
  fontWeight: 'bold',
  textAlign: 'center',
  stretch: 'horizontal'
});

// Legend panel initialization
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px'}});
map.add(legend);
  
// MapBiomas DRC class definitions
var classes = {
  "DenseForest": 3, "MountainForest": 7, "Miombo": 4, "Mangrove": 5, "Grassland": 12,
  "Woodland": 66, "Pasture": 15, "Agriculture": 18, "ForestPlantation": 9,
  "Urban": 24, "Mining": 30, "OtherNonVegetated": 25, "Water": 33, "Glacier": 34
};

// MapBiomas visualization colors
var visColors = {
  "DenseForest": "#1f8d49", "MountainForest": "#015c23", "Miombo": "#7dc975",
  "Mangrove": "#04381d", "Grassland": "#d6bc74", "Woodland": "#a89358",
  "Pasture": "#edde8e", "Agriculture": "#E974ED", "ForestPlantation": "#7a5900",
  "Urban": "#d4271e", "OtherNonVegetated": "#db4d4f", "Water": "#2532e4",
  "Glacier": "#93dfe6", "Mining": "#9c0027"
};

// Own vis colors
// var visColors = {
//   "DenseForest": "#d94fff", "MountainForest": "#ff2d1c", "Miombo": "#00ffff",
//   "Mangrove": "#d63000", "Grassland": "#98ff00", "Woodland": "#0b4a8b",
//   "Pasture": "#ffc82d", "Agriculture": "#00ffff", "ForestPlantation": "#bf04c2",
//   "Urban": "#ff0000", "OtherNonVegetated": "#d63000", "Water": "#98ff00",
//   "Glacier": "#0b4a8b", "Mining": "#ffc82d"
// };

var eeVisColors = ee.Dictionary(visColors);

/******* LOAD DATA ASSETS **********/
var validated_samples_contents = ee.data.listAssets(BIOME_ROOT_FOLDER);
var LAST_VALIDATED_SAMPLES = (validated_samples_contents.assets || [])
  .filter(function(asset) {
    return asset.type === 'TABLE' && asset.name.toLowerCase().indexOf('validated') !== -1;
  })
  .sort(function(a, b) {
    return new Date(b.updateTime) - new Date(a.updateTime);
  })[0];

var contents = ee.data.listAssets(SAMPLES_FOLDER);
var usersToSkip = []; // Exclude specific users
var SAMPLE_ASSETS = (contents.assets || [])
  .filter(function(asset) {
    if (usersToSkip.length === 0) return true;
    var isMatch = usersToSkip.some(function(user) {
      return asset.name.toLowerCase().indexOf(user.toLowerCase()) !== -1;
    });
    return !isMatch;
  })
  .map(function(asset) {
    return asset.id;
  });

/******* LOAD AND MERGE SAMPLES ********/
var mergedSamples;

if (LAST_VALIDATED_SAMPLES) {
  mergedSamples = ee.FeatureCollection(LAST_VALIDATED_SAMPLES.id);
  ee.Date(LAST_VALIDATED_SAMPLES.updateTime)
    .format("YYYY-MM-dd 'at' HH:mm")
    .evaluate(function(formattedDate) {
      timeLabel.setValue('Last modified: ' + formattedDate);
    });
} else {
  var samplesCollections = SAMPLE_ASSETS.map(function(id) { return ee.FeatureCollection(id); });
  mergedSamples = ee.FeatureCollection(samplesCollections)
    .flatten()
    .map(function(f) {
      var uid = ee.String(f.id()).cat('_').cat(ee.String(f.get('system:index')));
      return f.set('unique_id', uid).set('status', 'pending');
    });
}

/************ MAP DISPLAY INITIALIZATION ********************/
// Filter region and center map
regions = regions.filter(ee.Filter.eq('name', region_name));
map.centerObject(regions.geometry());
map.addLayer(ee.Image().paint(regions, 0, 2.5), {palette: ['cyan']}, region_name + ' region');

var allSamplesLayer = ui.Map.Layer(ee.FeatureCollection([]), {}, 'All Samples');
map.layers().add(allSamplesLayer);

var currentSampleLayer = ui.Map.Layer(ee.FeatureCollection([]), {color: 'yellow', width: 4}, 'CURRENT SAMPLE');
map.layers().add(currentSampleLayer);

/*********** LOGIC FUNCTIONS ********/

function updateProgress() {
  var stats = validatedSamples.aggregate_histogram('status');
  var total = validatedSamples.size();
  
  ee.Dictionary(stats).evaluate(function(s) {
    var val = s.validated || 0;
    var skip = s.skipped || 0;
    var pend = s.pending || 0;
    progressLabel.setValue('Validated: ' + val + ' | Skipped: ' + skip + ' | Pending: ' + pend);
  });
}

function refreshMap(fc) {
  var styled = fc.map(function(f) {
    var color = eeVisColors.get(f.get('className'), 'gray');
    var status = f.get('status');
    var isValidated = ee.Algorithms.IsEqual(status, 'validated');
    var isSkipped = ee.Algorithms.IsEqual(status, 'skipped');
    
    return f.set('style', {
      color: ee.Algorithms.If(isValidated, '#00ff00', color),
      fillColor: ee.Algorithms.If(isSkipped, '#00000000', color), // Hollow if skipped
      width: ee.Algorithms.If(isSkipped, 2, 1),
      pointSize: ee.Algorithms.If(isValidated, 5, 8)
    });
  });
  allSamplesLayer.setEeObject(styled.style({styleProperty: 'style'}));
}

function showNextPendingSample() {
  var nextSample = validatedSamples.filter(ee.Filter.eq('status', 'pending')).first();
  nextSample.evaluate(function(feature) {
    if (!feature) {
      infoLabel.setValue('🎉 All samples validated!');
      currentFeature = null;
      currentSampleLayer.setEeObject(ee.FeatureCollection([]));
      return;
    }
    currentFeature = ee.Feature(feature);
    map.centerObject(currentFeature.geometry(), 11);
    currentSampleLayer.setEeObject(ee.FeatureCollection([currentFeature]));
    classDropdown.setValue(currentFeature.get('className').getInfo(), false);
    infoLabel.setValue('Reviewing pending sample');
  });
}

function updateAggregatesAndLegend(fc) {
  var hist = fc.aggregate_histogram('className');
  var total = fc.size();
  createLegend({hist: hist, total: total});
  updateProgress();
}

function createLegend(samplesAggregate) {
  legend.clear();
  legend.add(ui.Label('Legend (Samples count)', {fontWeight: 'bold'}));
  
  ee.Dictionary(samplesAggregate).evaluate(function(stats) {
    Object.keys(stats.hist).forEach(function(clsName) {
      var count = stats.hist[clsName];
      var color = visColors[clsName] || '#999';
      var colorBox = ui.Label('', { backgroundColor: color, padding: '8px', margin: '0 6px 4px 0' });
      var className =  ui.Label({value: clsName, style: {margin: '0 0 4px 6px'}});
      var value = ui.Label({value: count, style: {margin: '0 0 4px 6px'}});
      legend.add(ui.Panel({widgets: [colorBox, className, value], layout: ui.Panel.Layout.Flow('horizontal')}));
    });
    legend.add(ui.Label({value: 'Total: ' + stats.total, style: {fontWeight: 'bold'}}));
  });
}

function goToIndex(index) {
  var listSize = currentFilteredSamples.size();
  listSize.evaluate(function(size) {
    if (size === 0) return;
    if (index < 0) index = 0;
    if (index >= size) {
      infoLabel.setValue('Reached end of list');
      return;
    }
    currentIndex = index;
    indexInput.setValue((index + 1).toString(), false); // Update text box
    
    var sample = ee.Feature(currentFilteredSamples.toList(1, index).get(0));
    sample.evaluate(function(f) {
      currentFeature = ee.Feature(f);
      map.centerObject(currentFeature.geometry(), 11);
      currentSampleLayer.setEeObject(ee.FeatureCollection([currentFeature]));
      classDropdown.setValue(f.properties.className, false);
      infoLabel.setValue('Sample ' + (index + 1) + ' of ' + size + ' (' + f.properties.className + ')');
    });
  });
}

function trainValidatesSamplesFn() {
  // For each year, create trained samples
  years.forEach(function(year) {
      // Get the Landsat mosaic for the given year 
      var img_year = Land_collection.filter(ee.Filter.eq('year', year));
      
      // Collect the spectral information of the polygons for the given year
      var trainedSamples = img_year.mosaic().sampleRegions({
          'collection': validatedSamples,
          'scale': 30,
          //'properties': ['class']
          //'tileScale': 2,
          'geometries': true
        });
      trainedSamples = trainedSamples.filter(ee.Filter.notNull(['red_median'])); // Why the red_median band?
      
      // add year as a variable 
      trainedSamples = trainedSamples.map(function(f) {return f.set('year', year)});
      
      // add signatures to the spectral library 
      trainedSamples_allyears = trainedSamples_allyears.merge(trainedSamples);
  });
  
  // Export the training data to GEE asset.
  Export.table.toAsset({
    collection: trainedSamples_allyears, 
    description: region_name + '_trained_Samples_export', 
    assetId: EXPORT_TRAINED_NAME,
  });
  
  infoLabel.setValue('Training finished...');
}

/*********** DATA INITIALIZATION ********/
var validatedSamples = mergedSamples.map(function(f) {
  return ee.Feature(f).set('status', 
    ee.Algorithms.If(f.propertyNames().contains('status'), f.get('status'), 'pending'));
});
var currentFilteredSamples = validatedSamples;

// Global Map Click
map.onClick(function(coords) {
  var point = ee.Geometry.Point([coords.lon, coords.lat]);
  var nearest = validatedSamples.filterBounds(point.buffer(bufferTolerance)).first();
  nearest.evaluate(function(x) {
    if (!x) {
      infoLabel.setValue('No sample found at the clicked point.');
      return;
    }
    currentFeature = ee.Feature(x);
    var cls = currentFeature.get('className').getInfo();
    infoLabel.setValue('Selected class: ' + cls);
    classDropdown.setValue(cls, false);
    currentSampleLayer.setEeObject(ee.FeatureCollection([currentFeature]));
  });
});

/********************* UI PANELS ***********************/
var mainPanel = ui.Panel({ style: { width: '350px' }, layout: ui.Panel.Layout.flow('vertical') });
var title = ui.Label(region_name + ' Samples Validation Tool', {
  color: 'green', fontSize: '24px', fontWeight: 'bold', textAlign: 'center', stretch: 'horizontal'
});
var infoLabel = ui.Label('Select a filter or click a sample to inspect', {color:'brown'});
var progressLabel = ui.Label('Loading progress...', {fontSize: '11px', color: 'gray'});

// Navigation
var btnPrev = ui.Button('◀ Prev', function() { goToIndex(currentIndex - 1); });
var btnNext = ui.Button('Next ▶', function() { goToIndex(currentIndex + 1); });
var indexInput = ui.Textbox({
  placeholder: 'Index',
  style: {width: '50px'},
  onChange: function(val) {
    var idx = parseInt(val);
    if (!isNaN(idx)) goToIndex(idx - 1);
  }
});
var navPanel = ui.Panel([btnPrev, indexInput, btnNext], ui.Panel.Layout.flow('horizontal'), {stretch: 'horizontal'});

// Filter dropdown
var selectClassDropdown = ui.Select({
  items: ['All Classes'],
  placeholder: 'Filter by class',
  onChange: function(selectedClass) {
    var filtered = (selectedClass === 'All Classes') ? validatedSamples : validatedSamples.filter(ee.Filter.eq('className', selectedClass));
    filtered.size().evaluate(function(count) {
      if (count === 0) {
        infoLabel.setValue('⚠️ No samples found for ' + selectedClass);
        return;
      }
      currentFilteredSamples = filtered;
      refreshMap(filtered); 
      
      filtered.aggregate_array('status').evaluate(function(states) {
        var firstPending = states.indexOf('pending');
        goToIndex(firstPending !== -1 ? firstPending : 0);
      });
    });
  }
});

// Skip Button logic updated to set status
var buttonSkip = ui.Button('Skip/Next', function() {
  if (currentFeature) {
    var idToSkip = currentFeature.get('unique_id');
    validatedSamples = validatedSamples.map(function(f) {
      return ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('unique_id'), idToSkip), f.set('status', 'skipped'), f);
    });
    refreshMap(currentFilteredSamples);
    updateProgress();
  }
  goToIndex(currentIndex + 1); 
});

var classDropdown = ui.Select({ items: Object.keys(classes), placeholder: 'Change class' });
classDropdown.onChange(function(value) {
  if (!currentFeature) return;
  classDropdown.setDisabled(true);
  var idToChange = currentFeature.get('unique_id');
  validatedSamples = validatedSamples.map(function(sample) {
    return ee.Algorithms.If(ee.Algorithms.IsEqual(sample.get('unique_id'), idToChange),
      sample.set({'class': classes[value], 
        'className': value,
        'status': 'validated',
        'validated_at': ee.Date(Date.now()).format('YYYY-MM-dd HH:mm')}),
      sample);
  });
  
  var filterVal = selectClassDropdown.getValue() || 'All Classes';
  currentFilteredSamples = (filterVal === 'All Classes') ? validatedSamples : validatedSamples.filter(ee.Filter.eq('className', filterVal));

  refreshMap(currentFilteredSamples);
  updateAggregatesAndLegend(validatedSamples);
  classDropdown.setDisabled(false);
  goToIndex(currentIndex + 1);
});

var buttonDelete = ui.Button({ label: 'Delete Sample', style: {backgroundColor: 'red', color: 'red'} });
buttonDelete.onClick(function() {
  if (!currentFeature) return;
  validatedSamples = validatedSamples.filter(ee.Filter.neq('unique_id', currentFeature.get('unique_id')));
  
  var filterVal = selectClassDropdown.getValue() || 'All Classes';
  currentFilteredSamples = (filterVal === 'All Classes') ? validatedSamples : validatedSamples.filter(ee.Filter.eq('className', filterVal));

  refreshMap(currentFilteredSamples);
  updateAggregatesAndLegend(validatedSamples);
  currentSampleLayer.setEeObject(ee.FeatureCollection([]));
  goToIndex(currentIndex); 
});

// Export and Utility Buttons
var buttonSave = ui.Button({ label: 'Save Validated Samples to Assets', style: {backgroundColor: 'green', color: 'green', stretch: 'horizontal'} });
buttonSave.onClick(function() {
  Export.table.toAsset({ collection: validatedSamples, description: region_name + '_validated_export', assetId: EXPORT_ASSET_NAME });
  infoLabel.setValue('Saving started...');
});

var buttonTrainSamples = ui.Button({ label: 'Trained Validated Samples', style: {backgroundColor: 'green', color: 'green', stretch: 'horizontal'} });
buttonTrainSamples.onClick(function() {
  trainValidatesSamplesFn();
  infoLabel.setValue('Training started...');
});

var buttonExport = ui.Button({ label: 'Export Validated Samples to Drive', style: {backgroundColor: 'green', color: 'brown', stretch: 'horizontal'} });
buttonExport.onClick(function() {
  Export.table.toDrive({ collection: validatedSamples, description: region_name + '_drive_export', folder: 'Earth_Engine', fileFormat: 'SHP' });
  infoLabel.setValue('Export started...');
});

var buttonHome = ui.Button('Back to Home view');
buttonHome.style().set({fontSize: '20px', fontWeight: 'bold', stretch: 'horizontal'});
buttonHome.onClick(function(){
  map.centerObject(regions.geometry());
  refreshMap(validatedSamples);
});

// Batch Delete
var deleteClassDropdown = ui.Select({ items: Object.keys(classes), placeholder: 'Select class' });
var buttonDeleteClass = ui.Button({ label: 'Delete All in Class', style: {backgroundColor: 'red', color: 'red'} });
buttonDeleteClass.onClick(function() {
  var selectedClass = deleteClassDropdown.getValue();
  if (!selectedClass) return;
  validatedSamples = validatedSamples.filter(ee.Filter.neq('className', selectedClass));
  var filterVal = selectClassDropdown.getValue() || 'All Classes';
  currentFilteredSamples = (filterVal === 'All Classes') ? validatedSamples : validatedSamples.filter(ee.Filter.eq('className', filterVal));
  refreshMap(currentFilteredSamples);
  updateAggregatesAndLegend(validatedSamples);
  infoLabel.setValue('Removed class: ' + selectedClass);
});

// Layout construction
var classSamplesCard = ui.Panel({
  widgets: [ui.Label('Batch delete', { fontWeight: 'bold' }), ui.Panel([ui.Label('Class:', {fontSize: '11px'}), deleteClassDropdown], ui.Panel.Layout.flow('horizontal')), buttonDeleteClass],
  style: { padding: '10px', margin: '10px', border: '1px solid #e0e0e0', backgroundColor: '#f8f9fa' }
});

var validationControlCard = ui.Panel({
  widgets: [ui.Label('Validation Controls', { fontWeight: 'bold' }), buttonSave, buttonExport, buttonHome],
  style: { padding: '10px', margin: '10px', border: '1px solid #e0e0e0', backgroundColor: '#f8f9fa' }
});

var validationTrainedCard = ui.Panel({
  widgets: [ui.Label('Trained data', { fontWeight: 'bold' }), buttonTrainSamples],
  style: { padding: '10px', margin: '10px', border: '1px solid #e0e0e0', backgroundColor: '#f8f9fa' }
});

mainPanel.add(title).add(timeLabel)
  .add(ui.Panel([ui.Label('Filter samples by class:'), selectClassDropdown], ui.Panel.Layout.flow('horizontal')))
  .add(infoLabel)
  .add(progressLabel)
  .add(navPanel)
  .add(ui.Panel([ui.Label('Change class: '), classDropdown, buttonDelete], ui.Panel.Layout.flow('horizontal')))
  .add(buttonSkip).add(validationControlCard).add(validationTrainedCard).add(classSamplesCard);

ui.root.add(mainPanel);

// Initialize UI
validatedSamples.aggregate_array('className').distinct().sort().evaluate(function(classList) {
  selectClassDropdown.items().reset(['All Classes'].concat(classList));
});
refreshMap(validatedSamples);
updateAggregatesAndLegend(validatedSamples);
showNextPendingSample();

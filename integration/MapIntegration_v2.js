// INTEGRATION OF REGIONAL CLASSIFICATIONS

// This script integrates the annual land use and land cover classifications
// produced independently for each classification region into a single
// national multiband classification. Each regional classification is stored
// as a multiband image containing one classification band per year. For each
// year, the corresponding regional bands are mosaicked into a national map.
// The annual mosaics are then combined into a single multiband image for
// visualization and export.

// Define the input regional classification collection
var input = ee.ImageCollection(
    'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft_2ndWS'
);

// Define the classification version to be used for each region
var regionVersions = {
    Miombo: '5',
    TerraFirma: '2',
    Mosaic: '2',
    Humid: '2',
    Mountain: '2'
};

// Define the years available in the classification time series
var years = [
    2000,2001,2002,2003,2004,2005,
    2006,2007,2008,2009,2010,2011,
    2012,2013,2014,2015,2016,2017,
    2018,2019,2020,2021,2022,2023,
    2024,2025
];

// Define a subset of years for visualization
var yearsView = [2000,2005,2010,2015,2020,2025];

// Load the Landsat mosaic collection
var Land_collection = ee.ImageCollection('projects/nexgenmap/MapBiomas2/LANDSAT/DRC/mosaics-2');

// Define visualization parameters for the Landsat mosaics
var visLandsat = {
    bands:['swir1_median','nir_median','red_median'],
    min:0,
    max:5615,
    gamma:1
};

// Load the DRC classification regions
var region_training = ee.FeatureCollection(
    'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/GENERAL/SAMPLES/drc_regions_training'
);

// Display the classification regions
Map.addLayer(region_training, {}, 'Regions', false);

// Initialize an object to store one multiband classification image for each region
var regionalImages = {};

// Read the multiband classification corresponding to each region
Object.keys(regionVersions).forEach(function(region){
  
    // Retrieve the classification version assigned to the region
    var version = regionVersions[region];
    
    // Load the regional multiband classification image
    regionalImages[region] = ee.Image(
        input
            .filter(ee.Filter.stringContains(
                'system:index',
                region + '_gapfill_transition_temporal_spatial_v' + version
            ))
            .first()
    );
    
    // Print the loaded image for inspection
    print(region, regionalImages[region]);

});


// 1. PREVALENCE RULES FOR OVERLAPPING AREAS
// Define an ecologically sensible priority order for overlapping boundaries.
// The class with the higher weight will prevail in the overlap zone.
// You can adjust these weights based on DRC's ecological behavior.

var classList = [
    33,  // River, lake and ocean     (Highest priority/certainty)
    24,  // Urban area                
    21,  // Pasture and Agriculture   
    9,   // Forest plantation         
    5,   // Mangrove                  
    3,   // Forest Formation          
    4,   // Woodland                  
    66,  // Shrubland                 
    25,  // Other non-vegetated area  
    34   // Glaciers                  (Lowest impact on overlap)
];

var priorityWeights = [
    100, // weight for 33
    90,  // weight for 24
    80,  // weight for 21
    70,  // weight for 9
    65,  // weight for 5
    60,  // weight for 3
    50,  // weight for 4
    40,  // weight for 66
    30,  // weight for 25
    10   // weight for 34
];


// 2. SPATIAL FILTER FUNCTION 

var minPixels = 6; // (0.5 ha = Minimum Mapping Unit)

var applySpatialFilter = function(image) {
    // Count connected pixels of the same class (up to the minPixels threshold)
    var patchSize = image.connectedPixelCount(minPixels, false);
    
    // Identify pixels belonging to patches smaller than 6 pixels
    var isSmallPatch = patchSize.lt(minPixels);
    
    // Calculate the most common neighboring class (focal mode)
    var majorityNeighbor = image.focalMode({
        radius: 1,
        kernelType: 'square',
        units: 'pixels'
    });
    
    // Replace the small patches with the majority neighbor
    return image.where(isSmallPatch, majorityNeighbor);
};

// Initialize a list to store the annual national classifications
var integratedBands = [];

// Loop through each year of the time series
years.forEach(function(year){
  
    // Initialize a list to store the regional classifications
    var images = [];
    
    // Read the corresponding classification band from each region
    Object.keys(regionalImages).forEach(function(region){

        // Select the current year band and rename it temporarily for standardization
        var classBand = regionalImages[region]
            .select(['classification_' + year], ['classification']);
            
        // Create a priority band based on the defined prevalence weights
        var priorityBand = classBand.remap(classList, priorityWeights, 0)
            .rename('priority');
            
        // Append the priority band to the classification and push to the list
        images.push(classBand.addBands(priorityBand));

    });
    
    // Mosaic all regional classifications into a national map using the priority.
    // qualityMosaic evaluates pixel by pixel. Where overlaps exist, 
    // it selects the pixel with the highest 'priority' value.
    var mosaic = ee.ImageCollection(images)
        .qualityMosaic('priority')
        .select(['classification'], ['classification_' + year]); 
        
    // Apply the 0.5ha spatial filter to clean up "salt-and-pepper" noise
    var filteredMosaic = applySpatialFilter(mosaic);
        
    // Store the annual classification
    integratedBands.push(filteredMosaic);

});

// Combine all annual classifications into a multiband image
var multiband = ee.Image.cat(integratedBands);

// Print the integrated multiband classification
print(multiband);

// Load the MapBiomas color palette
var palettes = require('users/mapbiomas/modules:Palettes.js');

// Define visualization parameters for the classification
var visLULC = {
    min:0,
    max:69,
    palette:palettes.get('classification9')
};

// Display the selected years
yearsView.forEach(function(year){
  
    // Display the corresponding Landsat mosaic
    Map.addLayer(
        Land_collection
            .filter(ee.Filter.eq('year', year))
            .filterBounds(region_training)
            .mosaic(),
        visLandsat,
        'Landsat ' + year,
        false
    );
  
    // Display the integrated annual classification
    Map.addLayer(
        multiband.select('classification_' + year),
        visLULC,
        'Classification ' + year,
        false
    );
    
});

// Define the output folder where the integrated classification will be exported
var output_folder =
    'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/INTEGRATION/classification/';

// Define the output version of the integrated classification
var integration_version_out = '2';

// Define the output asset name
var integration_name =
    'DRC_classification_integrated_v' + integration_version_out;

// Add metadata to the integrated classification
multiband = multiband
    .set({
        country: 'DRC',
        version: integration_version_out,
        collection: 1,
        description: 'Integrated regional classification with prevalence rules and 0.5ha spatial filter'
    });

// Export the integrated multiband classification as a Google Earth Engine asset
Export.image.toAsset({
    image: multiband,
    description: integration_name,
    assetId: output_folder + integration_name,
    region: region_training.geometry(),
    scale: 30,
    maxPixels: 1e13,
    pyramidingPolicy: {
        '.default': 'mode'
    }
});

Map.addLayer(ee.Image().paint(biomes, 0.7, 2), {palette:['yellow']}, 'DRC Biomes limit');

// Map.addLayer(biomes, null, 'DRC Biomes');

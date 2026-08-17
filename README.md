### <img src="https://flagcdn.com/w40/cd.png" width="20" alt="DRC flag"> Democratic Republic of the Congo 

Explore our specialized resources and tools designed specifically for analyzing and monitoring land use and cover in Democratic Republic of the Congo.

#### 🌍 Biomes of Democratic Republic of the Congo

- [**Humid Zone**](https://github.com/mapbiomas/drc-humid-zone)  
- [**Miombo**](https://github.com/mapbiomas/drc-miombo)  
- [**Mosaic**](https://github.com/mapbiomas/drc-mosaic)  
- [**Mountain**](https://github.com/mapbiomas/drc-mountain)  
- [**Terra Firma**](https://github.com/mapbiomas/drc-terra-firma)  

### 🛠️ LULC Integration and Post Classification Filters

Integration and Post Classification Filters of LULC data:
- [**Mapbiomas LULC Integration and Filters**](https://github.com/mapbiomas/brazil-integration-toolkit)  

### 🗄️ Statistics computation 
- [**Statistics**](https://github.com/mapbiomas/drc-all-initiatives/tree/main/statistics)

### 🗄️ Data access 
- [**Google Earth Engine**]
```javascript
// Load MapBiomas DRC LULC 
var collection = ee.Image(
  'projects/mapbiomas-drc/assets/LAND-COVER/COLLECTION-1/INTEGRATION/classificationDRC_classification_integrated_v10'
);

// Center the map on the DRC LULC collection
Map.centerObject(collection, 5);

// Set visualization years
var years = [2000, 2005, 2010, 2015, 2020, 2025];

// Define visualization parameters (color palette)
var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis_LULC = Palette.get('vis_LULC');

// Plot maps
years.forEach(function(year) {
  
  Map.addLayer(
    collection.select('classification_' + year),
    vis_LULC,
    'LULC ' + year
  );
  
});
```
[Link to script](https://code.earthengine.google.com/c439325bf3439bcdffb84234da33d43c)


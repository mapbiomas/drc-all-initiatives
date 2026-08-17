# =============================================================================
# MAPBIOMAS DRC - COLLECTION 1
#
# Merge yearly LULC statistics, attach:
#   - territory names from shapefiles
#   - complete class hierarchy from legend dictionary
#
# EXPORTS:
#
#   1. One CSV per territory type - LONG format
#   2. One XLSX per territory type - WIDE format with years pivoted
#
#
# INPUT TABLES:
#   ./table/v10/
#
# SHAPEFILES:
#   ../territories/
#
# DICTIONARY:
#   ../dict/dict_legend_drc_col1.csv
#
# OUTPUT:
#   ./table/v10/merged/
#
#
# TERRITORY MATCHING:
#
# country:
#   table$territory <-> shapefile$CODE_INS
#
# province:
#   table$territory <-> shapefile$CODE_INS
#
# territory:
#   table$territory <-> shapefile$CODE_INS
#
# protected_area:
#   table$territory <-> shapefile$OBJECTID_1
#
# biome:
#   table$territory <-> shapefile$id
#
#
# CLASS MATCHING:
#
#   table$class_id <-> dictionary$ID
#
#
# DICTIONARY COLUMNS RETAINED:
#
#   class_level0_5
#   hex_level0_5
#   class_level1
#   hex_level1
#   class_level2
#   hex_level2
#
#
# CSV OUTPUT:
#
#   territory_type
#   territory_name
#   class_id
#   class_level0_5
#   hex_level0_5
#   class_level1
#   hex_level1
#   class_level2
#   hex_level2
#   year
#   area
#
#
# XLSX OUTPUT:
#
#   territory_type
#   territory_name
#   class_id
#   class_level0_5
#   hex_level0_5
#   class_level1
#   hex_level1
#   class_level2
#   hex_level2
#   2000
#   2001
#   ...
#   2025
#
#
# ROW ORDER:
#
#   territory_name
#   class_level2
#   class_id
#
#
# EXCEL:
#
#   - only the header row is frozen
#   - NO vertical frozen separator before the years
#   - horizontal scrolling is free across metadata and year columns
#
#
# Areas are rounded to 2 decimal digits.
#
# Missing territory table groups are skipped with warnings.
# Missing individual years are reported but available years are processed.
#
# =============================================================================


# =============================================================================
# 1. PACKAGES
# =============================================================================

library(tidyverse)
library(sf)
library(openxlsx)


# =============================================================================
# 2. PATHS
# =============================================================================

table_dir <- "./table/v10"

territory_dir <- "../territories"

dictionary_file <- "../dict/dict_legend_drc_col1.csv"

output_dir <- file.path(
  table_dir,
  "merged"
)

dir.create(
  output_dir,
  recursive = TRUE,
  showWarnings = FALSE
)


# =============================================================================
# 3. EXPECTED YEARS
# =============================================================================

expected_years <- 2000:2025


# =============================================================================
# 4. DICTIONARY FIELDS TO RETAIN
# =============================================================================

dictionary_fields <- c(
  "class_level0_5",
  "hex_level0_5",
  "class_level1",
  "hex_level1",
  "class_level2",
  "hex_level2"
)


# =============================================================================
# 5. READ CLASS DICTIONARY
# =============================================================================

if (!file.exists(dictionary_file)) {
  
  stop(
    paste0(
      "Legend dictionary not found:\n",
      dictionary_file
    )
  )
}


dictionary <- read_csv(
  dictionary_file,
  show_col_types = FALSE
)


message("")
message("============================================================")
message("READING CLASS LEGEND")
message("============================================================")


# =============================================================================
# 6. CHECK DICTIONARY COLUMNS
# =============================================================================

required_dictionary_columns <- c(
  "ID",
  dictionary_fields
)


missing_dictionary_columns <- setdiff(
  required_dictionary_columns,
  names(dictionary)
)


if (length(missing_dictionary_columns) > 0) {
  
  stop(
    paste0(
      "The dictionary is missing required column(s):\n",
      paste(
        missing_dictionary_columns,
        collapse = ", "
      ),
      "\n\nAvailable columns are:\n",
      paste(
        names(dictionary),
        collapse = ", "
      )
    )
  )
}


message(
  "[OK] All required dictionary fields found."
)


# =============================================================================
# 7. CREATE CLASS LOOKUP
# =============================================================================

class_lookup <- dictionary %>%
  
  transmute(
    
    class_id = suppressWarnings(
      as.integer(
        as.character(ID)
      )
    ),
    
    class_level0_5 = as.character(
      class_level0_5
    ),
    
    hex_level0_5 = as.character(
      hex_level0_5
    ),
    
    class_level1 = as.character(
      class_level1
    ),
    
    hex_level1 = as.character(
      hex_level1
    ),
    
    class_level2 = as.character(
      class_level2
    ),
    
    hex_level2 = as.character(
      hex_level2
    )
    
  ) %>%
  
  filter(
    !is.na(class_id)
  )


# =============================================================================
# 8. CHECK DUPLICATED CLASS IDS
# =============================================================================

duplicate_classes <- class_lookup %>%
  
  count(
    class_id,
    name = "n"
  ) %>%
  
  filter(
    n > 1
  )


if (nrow(duplicate_classes) > 0) {
  
  warning(
    paste0(
      "[WARNING] Dictionary contains ",
      nrow(duplicate_classes),
      " duplicated class ID(s). ",
      "Only the first record for each class ID will be retained."
    ),
    call. = FALSE
  )
  
  
  message("")
  message("Duplicated class IDs:")
  
  
  print(
    as.data.frame(
      duplicate_classes
    )
  )
}


# =============================================================================
# 9. SHOW DUPLICATED DICTIONARY RECORDS
# =============================================================================

if (nrow(duplicate_classes) > 0) {
  
  duplicate_dictionary_records <- class_lookup %>%
    
    filter(
      class_id %in% duplicate_classes$class_id
    ) %>%
    
    arrange(
      class_id
    )
  
  
  message("")
  message("Dictionary records associated with duplicated IDs:")
  
  
  print(
    as.data.frame(
      duplicate_dictionary_records
    )
  )
}


# =============================================================================
# 10. KEEP ONE DICTIONARY RECORD PER CLASS ID
# =============================================================================

class_lookup <- class_lookup %>%
  
  arrange(
    class_id
  ) %>%
  
  distinct(
    class_id,
    .keep_all = TRUE
  )


message(
  "[OK] ",
  nrow(class_lookup),
  " unique class IDs available in dictionary."
)


# =============================================================================
# 11. FUNCTION: READ AND MERGE YEARLY TABLES
# =============================================================================

read_yearly_tables <- function(
    pattern,
    territory_name
) {
  
  files <- list.files(
    path = table_dir,
    pattern = pattern,
    full.names = TRUE
  )
  
  
  files <- sort(
    files
  )
  
  
  # ---------------------------------------------------------------------------
  # No files
  # ---------------------------------------------------------------------------
  
  if (length(files) == 0) {
    
    warning(
      paste0(
        "[SKIPPED] No yearly CSV files found for: ",
        territory_name
      ),
      call. = FALSE
    )
    
    return(NULL)
  }
  
  
  message("")
  message("============================================================")
  message("READING TABLES: ", territory_name)
  message("============================================================")
  
  
  message(
    "[FOUND] ",
    length(files),
    " CSV file(s)."
  )
  
  
  # ---------------------------------------------------------------------------
  # Read
  # ---------------------------------------------------------------------------
  
  x <- files %>%
    
    map_dfr(
      function(file) {
        
        read_csv(
          file,
          show_col_types = FALSE
        )
      }
    )
  
  
  # ---------------------------------------------------------------------------
  # Required columns
  # ---------------------------------------------------------------------------
  
  required_columns <- c(
    "territory",
    "territory_type",
    "class_id",
    "year",
    "area"
  )
  
  
  missing_columns <- setdiff(
    required_columns,
    names(x)
  )
  
  
  if (length(missing_columns) > 0) {
    
    stop(
      paste0(
        territory_name,
        " tables are missing required column(s): ",
        paste(
          missing_columns,
          collapse = ", "
        )
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Standardize types
  # ---------------------------------------------------------------------------
  
  x <- x %>%
    
    mutate(
      
      territory = suppressWarnings(
        as.numeric(
          as.character(territory)
        )
      ),
      
      territory_type = as.character(
        territory_type
      ),
      
      class_id = suppressWarnings(
        as.integer(
          class_id
        )
      ),
      
      year = suppressWarnings(
        as.integer(
          year
        )
      ),
      
      area = suppressWarnings(
        as.numeric(
          area
        )
      )
      
    )
  
  
  # ---------------------------------------------------------------------------
  # Invalid territory IDs
  # ---------------------------------------------------------------------------
  
  invalid_territories <- sum(
    is.na(x$territory)
  )
  
  
  if (invalid_territories > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " contains ",
        invalid_territories,
        " row(s) where territory could not be converted to numeric."
      ),
      call. = FALSE
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Missing years
  # ---------------------------------------------------------------------------
  
  found_years <- sort(
    unique(
      x$year
    )
  )
  
  
  missing_years <- setdiff(
    expected_years,
    found_years
  )
  
  
  if (length(missing_years) > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " is missing year(s): ",
        paste(
          missing_years,
          collapse = ", "
        )
      ),
      call. = FALSE
    )
    
  } else {
    
    message(
      "[OK] All years 2000-2025 found."
    )
  }
  
  
  x <- x %>%
    
    arrange(
      territory,
      class_id,
      year
    )
  
  
  message(
    "[OK] ",
    nrow(x),
    " rows loaded."
  )
  
  
  return(x)
}


# =============================================================================
# 12. READ STATISTICAL TABLES
# =============================================================================

country <- read_yearly_tables(
  
  pattern =
    "^drc_col1_lulc_area_country_[0-9]{4}\\.csv$",
  
  territory_name =
    "country"
)


province <- read_yearly_tables(
  
  pattern =
    "^drc_col1_lulc_area_province_[0-9]{4}\\.csv$",
  
  territory_name =
    "province"
)


territory <- read_yearly_tables(
  
  pattern =
    "^drc_col1_lulc_area_territory_[0-9]{4}\\.csv$",
  
  territory_name =
    "territory"
)


protected_area <- read_yearly_tables(
  
  pattern =
    "^drc_col1_lulc_area_protected_area_[0-9]{4}\\.csv$",
  
  territory_name =
    "protected_area"
)


biome <- read_yearly_tables(
  
  pattern =
    "^drc_col1_lulc_area_biome_[0-9]{4}\\.csv$",
  
  territory_name =
    "biome"
)


# =============================================================================
# 13. FUNCTION: READ SHAPEFILE IF NEEDED
# =============================================================================

read_shapefile_if_needed <- function(
    statistics,
    filename,
    territory_name
) {
  
  if (is.null(statistics)) {
    
    warning(
      paste0(
        "[SKIPPED] Shapefile processing for ",
        territory_name,
        " because no statistics tables were found."
      ),
      call. = FALSE
    )
    
    return(NULL)
  }
  
  
  shp_file <- file.path(
    territory_dir,
    filename
  )
  
  
  if (!file.exists(shp_file)) {
    
    stop(
      paste0(
        "Shapefile not found: ",
        shp_file
      )
    )
  }
  
  
  shp <- st_read(
    shp_file,
    quiet = TRUE
  )
  
  
  message(
    "[FOUND] ",
    territory_name,
    " shapefile: ",
    nrow(shp),
    " feature(s)."
  )
  
  
  return(shp)
}


# =============================================================================
# 14. READ SHAPEFILES
# =============================================================================

shp_country <- read_shapefile_if_needed(
  
  statistics =
    country,
  
  filename =
    "Limite_RDC_reproj.shp",
  
  territory_name =
    "country"
)


shp_province <- read_shapefile_if_needed(
  
  statistics =
    province,
  
  filename =
    "Limite_Province_RDC_reproj.shp",
  
  territory_name =
    "province"
)


shp_territory <- read_shapefile_if_needed(
  
  statistics =
    territory,
  
  filename =
    "Limite_territoire_RDC_reproj.shp",
  
  territory_name =
    "territory"
)


shp_protected_area <- read_shapefile_if_needed(
  
  statistics =
    protected_area,
  
  filename =
    "RDC_aires_protegees.shp",
  
  territory_name =
    "protected_area"
)


shp_biome <- read_shapefile_if_needed(
  
  statistics =
    biome,
  
  filename =
    "DRC_Biomes_v2_midline_croped.shp",
  
  territory_name =
    "biome"
)


# =============================================================================
# 15. FUNCTION: DETECT TERRITORY NAME FIELD
# =============================================================================

detect_name_column <- function(
    attrs,
    id_field,
    territory_name
) {
  
  column_names <- names(
    attrs
  )
  
  
  name_pattern <- if (identical(territory_name, "biome")) {
    "nom|name|biome"
  } else {
    "nom|name"
  }
  
  
  candidates <- column_names[
    grepl(
      name_pattern,
      column_names,
      ignore.case = TRUE
    )
  ]
  
  
  candidates <- candidates[
    !grepl(
      "code|id|type|objectid|shape",
      candidates,
      ignore.case = TRUE
    )
  ]
  
  
  candidates <- setdiff(
    candidates,
    id_field
  )
  
  
  if (length(candidates) == 0) {
    
    stop(
      paste0(
        "No territory-name column detected for ",
        territory_name,
        ".\n\nAvailable columns:\n",
        paste(
          column_names,
          collapse = ", "
        )
      )
    )
  }
  
  
  if (length(candidates) > 1) {
    
    warning(
      paste0(
        "[WARNING] Multiple possible territory-name columns detected for ",
        territory_name,
        ": ",
        paste(
          candidates,
          collapse = ", "
        ),
        ". Using: ",
        candidates[1]
      ),
      call. = FALSE
    )
  }
  
  
  message(
    "[NAME FIELD] ",
    territory_name,
    ": ",
    candidates[1]
  )
  
  
  return(
    candidates[1]
  )
}


# =============================================================================
# 16. FUNCTION: PREPARE TERRITORY LOOKUP
# =============================================================================

prepare_territory_lookup <- function(
    shp,
    id_field,
    territory_name
) {
  
  if (is.null(shp)) {
    
    return(NULL)
  }
  
  
  message("")
  message("============================================================")
  message("PREPARING SHAPEFILE: ", territory_name)
  message("============================================================")
  
  
  # ---------------------------------------------------------------------------
  # Check ID field
  # ---------------------------------------------------------------------------
  
  if (!(id_field %in% names(shp))) {
    
    stop(
      paste0(
        "Field '",
        id_field,
        "' was not found in ",
        territory_name,
        ".\n\nAvailable fields:\n",
        paste(
          names(shp),
          collapse = ", "
        )
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Remove geometry
  # ---------------------------------------------------------------------------
  
  attrs <- shp %>%
    st_drop_geometry()
  
  
  # ---------------------------------------------------------------------------
  # Detect territory name
  # ---------------------------------------------------------------------------
  
  name_field <- detect_name_column(
    
    attrs =
      attrs,
    
    id_field =
      id_field,
    
    territory_name =
      territory_name
  )
  
  
  # ---------------------------------------------------------------------------
  # Reproduce Earth Engine numeric ID
  # ---------------------------------------------------------------------------
  
  attrs <- attrs %>%
    
    mutate(
      
      match_id = suppressWarnings(
        as.numeric(
          as.character(
            .data[[id_field]]
          )
        )
      ),
      
      territory_name = as.character(
        .data[[name_field]]
      )
      
    )
  
  
  # ---------------------------------------------------------------------------
  # Invalid IDs
  # ---------------------------------------------------------------------------
  
  invalid_ids <- attrs %>%
    
    filter(
      is.na(match_id)
    )
  
  
  if (nrow(invalid_ids) > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " contains ",
        nrow(invalid_ids),
        " feature(s) with invalid ",
        id_field,
        ". They will be excluded."
      ),
      call. = FALSE
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Duplicate IDs
  # ---------------------------------------------------------------------------
  
  duplicates <- attrs %>%
    
    filter(
      !is.na(match_id)
    ) %>%
    
    count(
      match_id,
      name = "n"
    ) %>%
    
    filter(
      n > 1
    )
  
  
  if (nrow(duplicates) > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " has ",
        nrow(duplicates),
        " duplicated ",
        id_field,
        " ID(s). ",
        "They will be collapsed to one row per raster ID."
      ),
      call. = FALSE
    )
    
    
    message("")
    message(
      "Duplicated IDs:"
    )
    
    
    print(
      as.data.frame(
        duplicates
      )
    )
    
    
    duplicate_records <- attrs %>%
      
      filter(
        match_id %in% duplicates$match_id
      ) %>%
      
      select(
        all_of(id_field),
        match_id,
        territory_name
      ) %>%
      
      arrange(
        match_id,
        territory_name
      )
    
    
    message("")
    message(
      "Records associated with duplicated IDs:"
    )
    
    
    print(
      as.data.frame(
        duplicate_records
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Check conflicting territory names
  # ---------------------------------------------------------------------------
  
  conflicts <- attrs %>%
    
    filter(
      !is.na(match_id)
    ) %>%
    
    group_by(
      match_id
    ) %>%
    
    summarise(
      
      n_names = n_distinct(
        territory_name,
        na.rm = TRUE
      ),
      
      names_found = paste(
        sort(
          unique(
            territory_name[
              !is.na(territory_name)
            ]
          )
        ),
        collapse = " | "
      ),
      
      .groups = "drop"
      
    ) %>%
    
    filter(
      n_names > 1
    )
  
  
  if (nrow(conflicts) > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " contains duplicated raster IDs with different names. ",
        "The first record will be retained."
      ),
      call. = FALSE
    )
    
    
    print(
      as.data.frame(
        conflicts
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Minimal lookup
  # ---------------------------------------------------------------------------
  
  lookup <- attrs %>%
    
    filter(
      !is.na(match_id)
    ) %>%
    
    select(
      match_id,
      territory_name
    ) %>%
    
    arrange(
      match_id
    ) %>%
    
    distinct(
      match_id,
      .keep_all = TRUE
    )
  
  
  if (anyDuplicated(lookup$match_id) > 0) {
    
    stop(
      paste0(
        "Could not create unique territory lookup for ",
        territory_name,
        "."
      )
    )
  }
  
  
  message(
    "[OK] ",
    nrow(lookup),
    " unique raster ID(s) available."
  )
  
  
  return(
    lookup
  )
}


# =============================================================================
# 17. CREATE TERRITORY LOOKUPS
# =============================================================================

meta_country <- prepare_territory_lookup(
  
  shp =
    shp_country,
  
  id_field =
    "CODE_INS",
  
  territory_name =
    "country"
)


meta_province <- prepare_territory_lookup(
  
  shp =
    shp_province,
  
  id_field =
    "CODE_INS",
  
  territory_name =
    "province"
)


meta_territory <- prepare_territory_lookup(
  
  shp =
    shp_territory,
  
  id_field =
    "CODE_INS",
  
  territory_name =
    "territory"
)


meta_protected_area <- prepare_territory_lookup(
  
  shp =
    shp_protected_area,
  
  id_field =
    "OBJECTID_1",
  
  territory_name =
    "protected_area"
)


meta_biome <- prepare_territory_lookup(
  
  shp =
    shp_biome,
  
  id_field =
    "id",
  
  territory_name =
    "biome"
)


# =============================================================================
# 18. FUNCTION: CREATE FINAL LONG TABLE
# =============================================================================

prepare_final_table <- function(
    statistics,
    metadata,
    territory_name
) {
  
  if (is.null(statistics)) {
    
    warning(
      paste0(
        "[SKIPPED] Processing for ",
        territory_name,
        " because no statistics are available."
      ),
      call. = FALSE
    )
    
    return(NULL)
  }
  
  
  if (is.null(metadata)) {
    
    stop(
      paste0(
        "Statistics exist for ",
        territory_name,
        " but territory metadata are unavailable."
      )
    )
  }
  
  
  message("")
  message("============================================================")
  message("MATCH REPORT: ", territory_name)
  message("============================================================")
  
  
  # ---------------------------------------------------------------------------
  # Territory matching QA
  # ---------------------------------------------------------------------------
  
  stats_ids <- statistics %>%
    
    filter(
      !is.na(territory)
    ) %>%
    
    distinct(
      territory
    )
  
  
  shape_ids <- metadata %>%
    
    distinct(
      match_id
    )
  
  
  unmatched_territories <- stats_ids %>%
    
    anti_join(
      
      shape_ids,
      
      by = c(
        "territory" = "match_id"
      )
      
    )
  
  
  message(
    "Unique IDs in statistics: ",
    nrow(stats_ids)
  )
  
  
  message(
    "Unique IDs in shapefile: ",
    nrow(shape_ids)
  )
  
  
  message(
    "Statistics IDs without shapefile match: ",
    nrow(unmatched_territories)
  )
  
  
  if (nrow(unmatched_territories) > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " has ",
        nrow(unmatched_territories),
        " territory ID(s) without a shapefile match."
      ),
      call. = FALSE
    )
    
    
    print(
      as.data.frame(
        unmatched_territories
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Join territory name
  # ---------------------------------------------------------------------------
  
  n_before <- nrow(
    statistics
  )
  
  
  output <- statistics %>%
    
    left_join(
      
      metadata,
      
      by = c(
        "territory" = "match_id"
      )
      
    )
  
  
  if (nrow(output) != n_before) {
    
    stop(
      paste0(
        "Territory join changed row count for ",
        territory_name,
        "."
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Classes absent from dictionary
  # ---------------------------------------------------------------------------
  
  unmatched_classes <- output %>%
    
    distinct(
      class_id
    ) %>%
    
    anti_join(
      class_lookup,
      by = "class_id"
    ) %>%
    
    arrange(
      class_id
    )
  
  
  if (nrow(unmatched_classes) > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " contains ",
        nrow(unmatched_classes),
        " class ID(s) not found in the dictionary."
      ),
      call. = FALSE
    )
    
    
    message("")
    message(
      "Classes without dictionary match:"
    )
    
    
    print(
      as.data.frame(
        unmatched_classes
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Join dictionary
  # ---------------------------------------------------------------------------
  
  n_before_class_join <- nrow(
    output
  )
  
  
  output <- output %>%
    
    left_join(
      class_lookup,
      by = "class_id"
    )
  
  
  if (nrow(output) != n_before_class_join) {
    
    stop(
      paste0(
        "Dictionary join changed row count for ",
        territory_name,
        "."
      )
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Missing territory names
  # ---------------------------------------------------------------------------
  
  missing_names <- output %>%
    
    filter(
      is.na(territory_name) |
        territory_name == ""
    ) %>%
    
    distinct(
      territory
    )
  
  
  if (nrow(missing_names) > 0) {
    
    warning(
      paste0(
        "[WARNING] ",
        territory_name,
        " has ",
        nrow(missing_names),
        " territory ID(s) without a territory name."
      ),
      call. = FALSE
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Final long table
  #
  # ORDER:
  # territory_name -> class_level2 -> class_id -> year
  # ---------------------------------------------------------------------------
  
  output <- output %>%
    
    transmute(
      
      territory_type =
        territory_type,
      
      territory_name =
        territory_name,
      
      class_id =
        class_id,
      
      class_level0_5 =
        class_level0_5,
      
      hex_level0_5 =
        hex_level0_5,
      
      class_level1 =
        class_level1,
      
      hex_level1 =
        hex_level1,
      
      class_level2 =
        class_level2,
      
      hex_level2 =
        hex_level2,
      
      year =
        year,
      
      area = round(
        area,
        digits = 2
      )
      
    ) %>%
    
    arrange(
      territory_name,
      class_level2,
      class_id,
      year
    )
  
  
  message(
    "[OK] ",
    territory_name,
    ": ",
    nrow(output),
    " final row(s)."
  )
  
  
  return(
    output
  )
}


# =============================================================================
# 19. CREATE FINAL LONG TABLES
# =============================================================================

country <- prepare_final_table(
  
  statistics =
    country,
  
  metadata =
    meta_country,
  
  territory_name =
    "country"
)


province <- prepare_final_table(
  
  statistics =
    province,
  
  metadata =
    meta_province,
  
  territory_name =
    "province"
)


territory <- prepare_final_table(
  
  statistics =
    territory,
  
  metadata =
    meta_territory,
  
  territory_name =
    "territory"
)


protected_area <- prepare_final_table(
  
  statistics =
    protected_area,
  
  metadata =
    meta_protected_area,
  
  territory_name =
    "protected_area"
)


biome <- prepare_final_table(
  
  statistics =
    biome,
  
  metadata =
    meta_biome,
  
  territory_name =
    "biome"
)


# =============================================================================
# 20. CHECK YEARS
# =============================================================================

check_years <- function(
    x,
    name
) {
  
  if (is.null(x)) {
    
    warning(
      paste0(
        "[SKIPPED] Year check for ",
        name,
        "."
      ),
      call. = FALSE
    )
    
    return(
      invisible(NULL)
    )
  }
  
  
  missing_years <- setdiff(
    expected_years,
    unique(x$year)
  )
  
  
  if (length(missing_years) == 0) {
    
    message(
      "[OK] ",
      name,
      ": all years 2000-2025 present."
    )
    
  } else {
    
    warning(
      paste0(
        "[WARNING] ",
        name,
        " missing year(s): ",
        paste(
          missing_years,
          collapse = ", "
        )
      ),
      call. = FALSE
    )
  }
}


check_years(
  country,
  "country"
)

check_years(
  province,
  "province"
)

check_years(
  territory,
  "territory"
)

check_years(
  protected_area,
  "protected_area"
)

check_years(
  biome,
  "biome"
)


# =============================================================================
# 21. CHECK DUPLICATED FINAL RECORDS
# =============================================================================

check_duplicates <- function(
    x,
    name
) {
  
  if (is.null(x)) {
    
    return(
      invisible(NULL)
    )
  }
  
  
  duplicates <- x %>%
    
    count(
      territory_type,
      territory_name,
      class_id,
      year,
      name = "n"
    ) %>%
    
    filter(
      n > 1
    )
  
  
  if (nrow(duplicates) == 0) {
    
    message(
      "[OK] ",
      name,
      ": no duplicated territory/class/year records."
    )
    
  } else {
    
    warning(
      paste0(
        "[WARNING] ",
        name,
        " contains ",
        nrow(duplicates),
        " duplicated territory/class/year combination(s). ",
        "They will be summed when producing the XLSX."
      ),
      call. = FALSE
    )
    
    
    print(
      as.data.frame(
        duplicates
      )
    )
  }
}


check_duplicates(
  country,
  "country"
)

check_duplicates(
  province,
  "province"
)

check_duplicates(
  territory,
  "territory"
)

check_duplicates(
  protected_area,
  "protected_area"
)

check_duplicates(
  biome,
  "biome"
)


# =============================================================================
# 22. SAVE LONG CSV
# =============================================================================

save_csv_table <- function(
    x,
    filename,
    name
) {
  
  if (is.null(x)) {
    
    warning(
      paste0(
        "[SKIPPED] ",
        name,
        " CSV not created because no data are available."
      ),
      call. = FALSE
    )
    
    return(
      invisible(NULL)
    )
  }
  
  
  output_file <- file.path(
    output_dir,
    filename
  )
  
  
  x <- x %>%
    
    mutate(
      area = round(
        area,
        2
      )
    ) %>%
    
    arrange(
      territory_name,
      class_level2,
      class_id,
      year
    )
  
  
  write_csv(
    x,
    output_file,
    na = ""
  )
  
  
  message(
    "[CSV SAVED] ",
    output_file
  )
}


# =============================================================================
# 23. EXPORT CSV FILES
# =============================================================================

save_csv_table(
  
  country,
  
  "drc_col1_lulc_area_country_2000_2025.csv",
  
  "country"
)


save_csv_table(
  
  province,
  
  "drc_col1_lulc_area_province_2000_2025.csv",
  
  "province"
)


save_csv_table(
  
  territory,
  
  "drc_col1_lulc_area_territory_2000_2025.csv",
  
  "territory"
)


save_csv_table(
  
  protected_area,
  
  "drc_col1_lulc_area_protected_area_2000_2025.csv",
  
  "protected_area"
)


save_csv_table(
  
  biome,
  
  "drc_col1_lulc_area_biome_2000_2025.csv",
  
  "biome"
)


# =============================================================================
# 24. PIVOT YEAR TO COLUMNS
#
# ROW ORDER:
#
# territory_name
# class_level2
# class_id
#
# =============================================================================

pivot_years <- function(
    x,
    name
) {
  
  if (is.null(x)) {
    
    warning(
      paste0(
        "[SKIPPED] Pivot for ",
        name,
        " because no data are available."
      ),
      call. = FALSE
    )
    
    return(NULL)
  }
  
  
  # ---------------------------------------------------------------------------
  # Aggregate exact duplicate combinations
  # ---------------------------------------------------------------------------
  
  wide <- x %>%
    
    group_by(
      
      territory_type,
      territory_name,
      
      class_id,
      
      class_level0_5,
      hex_level0_5,
      
      class_level1,
      hex_level1,
      
      class_level2,
      hex_level2,
      
      year
      
    ) %>%
    
    summarise(
      
      area = round(
        sum(
          area,
          na.rm = TRUE
        ),
        2
      ),
      
      .groups = "drop"
      
    )
  
  
  # ---------------------------------------------------------------------------
  # Pivot
  # ---------------------------------------------------------------------------
  
  wide <- wide %>%
    
    pivot_wider(
      
      id_cols = c(
        
        territory_type,
        territory_name,
        
        class_id,
        
        class_level0_5,
        hex_level0_5,
        
        class_level1,
        hex_level1,
        
        class_level2,
        hex_level2
        
      ),
      
      names_from =
        year,
      
      values_from =
        area,
      
      names_sort =
        TRUE
      
    )
  
  
  # ---------------------------------------------------------------------------
  # Guarantee all year columns 2000-2025
  # ---------------------------------------------------------------------------
  
  year_columns <- as.character(
    expected_years
  )
  
  
  missing_columns <- setdiff(
    year_columns,
    names(wide)
  )
  
  
  if (length(missing_columns) > 0) {
    
    for (yr in missing_columns) {
      
      wide[[yr]] <- NA_real_
      
    }
  }
  
  
  # ---------------------------------------------------------------------------
  # Correct column order + ROW ORDER BY class_level2
  # ---------------------------------------------------------------------------
  
  wide <- wide %>%
    
    select(
      
      territory_type,
      territory_name,
      
      class_id,
      
      class_level0_5,
      hex_level0_5,
      
      class_level1,
      hex_level1,
      
      class_level2,
      hex_level2,
      
      all_of(
        year_columns
      )
      
    ) %>%
    
    arrange(
      territory_name,
      class_level2,
      class_id
    )
  
  
  # ---------------------------------------------------------------------------
  # Round all year columns
  # ---------------------------------------------------------------------------
  
  wide <- wide %>%
    
    mutate(
      
      across(
        all_of(year_columns),
        ~ round(.x, 2)
      )
      
    )
  
  
  message(
    "[PIVOTED] ",
    name,
    ": ",
    nrow(wide),
    " row(s)."
  )
  
  
  return(
    wide
  )
}


# =============================================================================
# 25. CREATE WIDE TABLES
# =============================================================================

country_wide <- pivot_years(
  country,
  "country"
)


province_wide <- pivot_years(
  province,
  "province"
)


territory_wide <- pivot_years(
  territory,
  "territory"
)


protected_area_wide <- pivot_years(
  protected_area,
  "protected_area"
)


biome_wide <- pivot_years(
  biome,
  "biome"
)


# =============================================================================
# 26. FUNCTION: SAVE XLSX
#
# IMPORTANT:
#
# Only the HEADER ROW is frozen.
#
# There is NO vertical frozen pane / separator between metadata and years.
#
# You can scroll horizontally freely through:
#
# metadata -> 2000 -> 2001 -> ... -> 2025
#
# =============================================================================

save_xlsx_table <- function(
    x,
    filename,
    sheet_name,
    name
) {
  
  if (is.null(x)) {
    
    warning(
      paste0(
        "[SKIPPED] ",
        name,
        " XLSX not created because no data are available."
      ),
      call. = FALSE
    )
    
    return(
      invisible(NULL)
    )
  }
  
  
  output_file <- file.path(
    output_dir,
    filename
  )
  
  
  # ---------------------------------------------------------------------------
  # Workbook
  # ---------------------------------------------------------------------------
  
  wb <- createWorkbook()
  
  
  addWorksheet(
    wb,
    sheetName = sheet_name
  )
  
  
  # ---------------------------------------------------------------------------
  # Styles
  # ---------------------------------------------------------------------------
  
  header_style <- createStyle(
    
    fontColour =
      "#FFFFFF",
    
    fgFill =
      "#1F4E78",
    
    textDecoration =
      "bold",
    
    halign =
      "center",
    
    valign =
      "center",
    
    border =
      "Bottom"
    
  )
  
  
  area_style <- createStyle(
    
    numFmt =
      "#,##0.00"
    
  )
  
  
  class_id_style <- createStyle(
    
    numFmt =
      "0",
    
    halign =
      "center"
    
  )
  
  
  # ---------------------------------------------------------------------------
  # Write data
  # ---------------------------------------------------------------------------
  
  writeData(
    
    wb,
    
    sheet =
      sheet_name,
    
    x =
      x,
    
    startRow =
      1,
    
    startCol =
      1,
    
    headerStyle =
      header_style,
    
    withFilter =
      TRUE,
    
    keepNA =
      FALSE
    
  )
  
  
  # ---------------------------------------------------------------------------
  # Freeze ONLY top/header row.
  #
  # No firstActiveCol is specified.
  #
  # Therefore there is NO vertical separator/frozen pane.
  # ---------------------------------------------------------------------------
  
  freezePane(
    
    wb,
    
    sheet =
      sheet_name,
    
    firstActiveRow =
      2
    
  )
  
  
  # ---------------------------------------------------------------------------
  # class_id formatting
  # ---------------------------------------------------------------------------
  
  if (nrow(x) > 0) {
    
    addStyle(
      
      wb,
      
      sheet =
        sheet_name,
      
      style =
        class_id_style,
      
      rows =
        2:(nrow(x) + 1),
      
      cols =
        3,
      
      gridExpand =
        TRUE,
      
      stack =
        TRUE
      
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Year / area formatting
  #
  # Metadata columns:
  #
  # 1 territory_type
  # 2 territory_name
  # 3 class_id
  # 4 class_level0_5
  # 5 hex_level0_5
  # 6 class_level1
  # 7 hex_level1
  # 8 class_level2
  # 9 hex_level2
  #
  # Year columns start at 10.
  # ---------------------------------------------------------------------------
  
  if (
    nrow(x) > 0 &&
    ncol(x) >= 10
  ) {
    
    addStyle(
      
      wb,
      
      sheet =
        sheet_name,
      
      style =
        area_style,
      
      rows =
        2:(nrow(x) + 1),
      
      cols =
        10:ncol(x),
      
      gridExpand =
        TRUE,
      
      stack =
        TRUE
      
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Column widths
  # ---------------------------------------------------------------------------
  
  setColWidths(
    wb,
    sheet_name,
    cols = 1,
    widths = 18
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 2,
    widths = 30
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 3,
    widths = 10
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 4,
    widths = 28
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 5,
    widths = 14
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 6,
    widths = 28
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 7,
    widths = 14
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 8,
    widths = 28
  )
  
  
  setColWidths(
    wb,
    sheet_name,
    cols = 9,
    widths = 14
  )
  
  
  # ---------------------------------------------------------------------------
  # Year columns
  # ---------------------------------------------------------------------------
  
  if (ncol(x) >= 10) {
    
    setColWidths(
      
      wb,
      
      sheet_name,
      
      cols =
        10:ncol(x),
      
      widths =
        14
      
    )
  }
  
  
  # ---------------------------------------------------------------------------
  # Header row height
  # ---------------------------------------------------------------------------
  
  setRowHeights(
    
    wb,
    
    sheet_name,
    
    rows =
      1,
    
    heights =
      26
    
  )
  
  
  # ---------------------------------------------------------------------------
  # Save
  # ---------------------------------------------------------------------------
  
  saveWorkbook(
    
    wb,
    
    file =
      output_file,
    
    overwrite =
      TRUE
    
  )
  
  
  message(
    "[XLSX SAVED] ",
    output_file
  )
}


# =============================================================================
# 27. EXPORT XLSX FILES
# =============================================================================

save_xlsx_table(
  
  country_wide,
  
  "drc_col1_lulc_area_country_2000_2025.xlsx",
  
  "country",
  
  "country"
)


save_xlsx_table(
  
  province_wide,
  
  "drc_col1_lulc_area_province_2000_2025.xlsx",
  
  "province",
  
  "province"
)


save_xlsx_table(
  
  territory_wide,
  
  "drc_col1_lulc_area_territory_2000_2025.xlsx",
  
  "territory",
  
  "territory"
)


save_xlsx_table(
  
  protected_area_wide,
  
  "drc_col1_lulc_area_protected_area_2000_2025.xlsx",
  
  "protected_area",
  
  "protected_area"
)


save_xlsx_table(
  
  biome_wide,
  
  "drc_col1_lulc_area_biome_2000_2025.xlsx",
  
  "biome",
  
  "biome"
)


# =============================================================================
# 28. FINAL STATUS
# =============================================================================

status <- tibble(
  
  territory_type = c(
    "country",
    "province",
    "territory",
    "protected_area",
    "biome"
  ),
  
  available = c(
    !is.null(country),
    !is.null(province),
    !is.null(territory),
    !is.null(protected_area),
    !is.null(biome)
  )
  
) %>%
  
  mutate(
    
    status = if_else(
      available,
      "PROCESSED",
      "SKIPPED - NO TABLES"
    )
    
  )


message("")
message("============================================================")
message("FINAL STATUS")
message("============================================================")


print(
  as.data.frame(
    status
  )
)


# =============================================================================
# 29. OUTPUT SUMMARY
# =============================================================================

message("")
message("============================================================")
message("OUTPUT FILES")
message("============================================================")


if (!is.null(country)) {
  
  message("")
  message("COUNTRY")
  
  message(
    "  CSV  -> drc_col1_lulc_area_country_2000_2025.csv"
  )
  
  message(
    "  XLSX -> drc_col1_lulc_area_country_2000_2025.xlsx"
  )
}


if (!is.null(province)) {
  
  message("")
  message("PROVINCE")
  
  message(
    "  CSV  -> drc_col1_lulc_area_province_2000_2025.csv"
  )
  
  message(
    "  XLSX -> drc_col1_lulc_area_province_2000_2025.xlsx"
  )
}


if (!is.null(territory)) {
  
  message("")
  message("TERRITORY")
  
  message(
    "  CSV  -> drc_col1_lulc_area_territory_2000_2025.csv"
  )
  
  message(
    "  XLSX -> drc_col1_lulc_area_territory_2000_2025.xlsx"
  )
}


if (!is.null(protected_area)) {
  
  message("")
  message("PROTECTED AREA")
  
  message(
    "  CSV  -> drc_col1_lulc_area_protected_area_2000_2025.csv"
  )
  
  message(
    "  XLSX -> drc_col1_lulc_area_protected_area_2000_2025.xlsx"
  )
}


if (!is.null(biome)) {
  
  message("")
  message("BIOME")
  
  message(
    "  CSV  -> drc_col1_lulc_area_biome_2000_2025.csv"
  )
  
  message(
    "  XLSX -> drc_col1_lulc_area_biome_2000_2025.xlsx"
  )
}


message("")
message(
  "Output directory: ",
  output_dir
)


# =============================================================================
# 30. OPTIONAL PREVIEW
# =============================================================================

if (!is.null(province)) {
  
  message("")
  message("LONG FORMAT EXAMPLE:")
  
  
  print(
    as.data.frame(
      head(
        province,
        10
      )
    )
  )
}


if (!is.null(province_wide)) {
  
  message("")
  message("PIVOTED FORMAT EXAMPLE:")
  
  
  print(
    as.data.frame(
      head(
        province_wide,
        10
      )
    )
  )
}

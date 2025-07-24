#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <curl/curl.h>

// Defined variables
#define SUCCESS 0
#define FAILURE 1
#define SIZE	9

// Give JPL Horizons ID for each body
const char *id[9] = {"010", "199", "299", "399", "499", "599", "699", "799", "899"};

// Curl variables
CURL *curl;
CURLcode result;
struct MemoryStruct chunk;
double body_vars[6];
int year;
char url[250];
char *pos[7];
char var[50];

// Function to write data
struct MemoryStruct {
	char *memory;
	size_t size;
};

static size_t WriteMemoryCallback(void *contents, size_t size, size_t nmemb, void *userp) {
	size_t realsize = size * nmemb;
	struct MemoryStruct *mem = (struct MemoryStruct *)userp;
	char *ptr = realloc(mem->memory, mem->size + realsize + 1);
	if (ptr == NULL) {
		printf("not enough memory (realloc returned NULL)\n");
		return 0;
	}

	mem->memory = ptr;
	memcpy(&(mem->memory[mem->size]), contents, realsize);
	mem->size += realsize;
	mem->memory[mem->size] = 0;

	return realsize;
}

int get_body_vars(int body) {
	// Create chunk
	chunk.memory = malloc(1);
	chunk.size = 0;

	// Get correct url and curl operations
	sprintf(url, "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='%s'&CENTER='@0'&EPHEM_TYPE='VECTOR'&VEC_TABLE='2'&OUT_UNITS='AU-D'&START_TIME='%d-01-01'&STOP_TIME='%d-01-02'&STEP_SIZE='2%%20d'", id[body], year, year);
	curl_easy_setopt(curl, CURLOPT_URL, url);

	result = curl_easy_perform(curl);
	if (result != CURLE_OK) {
		printf("ERROR: curl could not fetch, %s\n", curl_easy_strerror(result));
		return FAILURE;
	}

	// Find all required positions in string
	pos[0] = strstr(chunk.memory, "X =");
	pos[1] = strstr(chunk.memory, "Y =");
	pos[2] = strstr(chunk.memory, "Z =");
	pos[3] = strstr(chunk.memory, "VX=");
	pos[4] = strstr(chunk.memory, "VY=");
	pos[5] = strstr(chunk.memory, "VZ=");
	pos[6] = strstr(chunk.memory, "$$EOE");

	for (int i = 0; i < 6; i++) {
		strncpy(var, (pos[i] + 3), pos[i + 1] - pos[i] + 3);
		body_vars[i] = atof(var);
	}

	// Cleanup chunk
	free(chunk.memory);
	return SUCCESS;
}

int main(int argc, char **argv) {
	// Check if correct number of arguments is given
	if (argc != 3) {
		printf("USAGE: ./api INITIAL_YEAR FINAL_YEAR\n");
		return FAILURE;
	}

	// Get initial and final year from arguments
	int initial_year = atoi(argv[1]);
	int final_year = atoi(argv[2]);

	// Check if initial year is smaller than final year
	if (initial_year >= final_year) {
		printf("ERROR: INITIAL_YEAR must be smaller than FINAL_YEAR\n");
		return FAILURE;
	}

	// Create and open JSON file
	FILE *json = fopen("api.json", "wt");
	if (json == NULL) {
		printf("ERROR: Could not open file\n");
		return FAILURE;
	}

	// Initialize curl
	curl_global_init(CURL_GLOBAL_ALL);

	// Create curl object
	curl = curl_easy_init();
	if (curl == NULL) {
		printf("ERROR: Curl could not be initialized\n");
		return FAILURE;
	}

	// Set curl operations
	curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
	curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void *)&chunk);

	// Write JSON file
	fprintf(json, "{\n");
	for (int i = initial_year; i <= final_year; i++) {
		year = i;	// Set

		int current = year % 3;
		if (current == 0) printf("Getting year %d...\n", year);
		else if (current == 1) printf("Getting year %d..\n", year);
		else printf("Getting year %d.\n", year);
		fprintf(json, "\"%d\": [", year);

		// Get initial vectors for all bodies for the year
		for (int j = 0; j < SIZE; j++) {
			int status = get_body_vars(j);	// Get initial vector of body
			if (status == FAILURE) {
				printf("ERROR: Ending job.\n");
				return FAILURE;
			}

			if (j == (SIZE - 1)) fprintf(json, "[%lf, %lf, %lf, %lf, %lf, %lf]", body_vars[0], body_vars[1], body_vars[2], body_vars[3], body_vars[4], body_vars[5]);
			else fprintf(json, "[%lf, %lf, %lf, %lf, %lf, %lf], ", body_vars[0], body_vars[1], body_vars[2], body_vars[3], body_vars[4], body_vars[5]);
		}

		if (i < final_year) fprintf(json, "],\n");
		else fprintf(json, "]\n");
	}
	printf("Job finished.\n");
	fprintf(json, "}");
	fclose(json);

	// Cleanup curl
	curl_easy_cleanup(curl);
	curl_global_cleanup();
	return SUCCESS;
}
